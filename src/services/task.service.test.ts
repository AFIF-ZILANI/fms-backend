import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { TaskService } from "./task.service";
import { AppError } from "@lib/app-error";

const createdTaskIds: string[] = [];
const createdTypeIds: string[] = [];
let taskTypeId: string;

const label = (base: string) => `${base} ${crypto.randomUUID().slice(0, 8)}`;

async function newTask(base: string, task_type_id?: string | null) {
    const task = await TaskService.create({
        label: label(base),
        ...(task_type_id !== undefined && { task_type_id }),
    });
    createdTaskIds.push(task.id);
    return task;
}

describe("TaskService", () => {
    beforeAll(async () => {
        const type = await prisma.taskType.create({
            data: { code: `ENVIRONMENT_${crypto.randomUUID().slice(0, 8)}`, label: "Environment" },
        });
        createdTypeIds.push(type.id);
        taskTypeId = type.id;
    });

    afterAll(async () => {
        await prisma.tasks.deleteMany({ where: { id: { in: createdTaskIds } } });
        await prisma.taskType.deleteMany({ where: { id: { in: createdTypeIds } } });
    });

    // Labels carry a random suffix throughout: the suite shares a database with
    // every other suite and has no per-test isolation, so a fixed label would
    // collide with its own leftovers after any interrupted run.
    test("create derives code from label and links the task type", async () => {
        const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();
        const task = await TaskService.create({
            label: `Morning Environment Reading ${suffix}`,
            task_type_id: taskTypeId,
        });
        createdTaskIds.push(task.id);
        expect(task.code).toBe(`MORNING_ENVIRONMENT_READING_${suffix}`);
        expect(task.task_type_id).toBe(taskTypeId);
        expect(task.task_type?.label).toBe("Environment");
        expect(task.is_active).toBe(true);
    });

    test("create without a task type is a plain mark-done task", async () => {
        const task = await newTask("Fix Water Line");
        expect(task.task_type_id).toBeNull();
        expect(task.task_type).toBeNull();
    });

    test("create rejects a label with no letters or digits", async () => {
        await expect(TaskService.create({ label: "!!!" })).rejects.toBeInstanceOf(AppError);
    });

    test("create rejects a duplicate resulting code", async () => {
        const base = `Duplicate Task Code ${crypto.randomUUID().slice(0, 8)}`;
        const task = await TaskService.create({ label: base });
        createdTaskIds.push(task.id);
        // Same code, different casing -- generateCode uppercases, so these collide.
        await expect(TaskService.create({ label: base.toLowerCase() })).rejects.toBeInstanceOf(
            AppError,
        );
    });

    // The regression that would break mobile routing silently: the app maps a
    // task's type to a screen and identifies rows by code, so a rename must not
    // move it. lookup-factory regenerates by default -- this service must not.
    test("update changes the label but never the code", async () => {
        const task = await newTask("Renameable Task");
        const originalCode = task.code;

        const updated = await TaskService.update(task.id, { label: "Renamed Task Entirely" });
        expect(updated.label).toBe("Renamed Task Entirely");
        expect(updated.code).toBe(originalCode);
    });

    test("update can relink and unlink the task type", async () => {
        const task = await newTask("Relinkable Task");
        expect(task.task_type_id).toBeNull();

        const linked = await TaskService.update(task.id, { task_type_id: taskTypeId });
        expect(linked.task_type_id).toBe(taskTypeId);

        const unlinked = await TaskService.update(task.id, { task_type_id: null });
        expect(unlinked.task_type_id).toBeNull();
    });

    test("update rejects a label with no letters or digits", async () => {
        const task = await newTask("Guarded Task");
        await expect(TaskService.update(task.id, { label: "???" })).rejects.toBeInstanceOf(
            AppError,
        );
    });

    test("update on a missing task is a not-found", async () => {
        await expect(
            TaskService.update(crypto.randomUUID(), { label: "Nope" }),
        ).rejects.toBeInstanceOf(AppError);
    });

    test("setActive toggles is_active and getAll filters on it", async () => {
        const task = await newTask("Toggleable Task");

        const deactivated = await TaskService.setActive(task.id, false);
        expect(deactivated.is_active).toBe(false);

        const { rows } = await TaskService.getAll({ active: "true", page: 1, limit: 100 });
        expect(rows.find((r) => r.id === task.id)).toBeUndefined();

        const reactivated = await TaskService.setActive(task.id, true);
        expect(reactivated.is_active).toBe(true);
    });

    test("getAll filters by task_type_id", async () => {
        const typed = await newTask("Typed Task", taskTypeId);
        await newTask("Untyped Task");

        const { rows } = await TaskService.getAll({
            task_type_id: taskTypeId,
            page: 1,
            limit: 100,
        });
        expect(rows.some((r) => r.id === typed.id)).toBe(true);
        expect(rows.every((r) => r.task_type_id === taskTypeId)).toBe(true);
    });

    test("deleting a task still referenced by an assignment is refused", async () => {
        const task = await newTask("Referenced Task", taskTypeId);

        const profile = await prisma.profiles.create({
            data: {
                name: "Task Delete Guard",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "EMPLOYEE",
            },
        });
        const employee = await prisma.employees.create({
            data: { profile_id: profile.id, role: "WORKER", salary: 15000 },
        });
        const assignment = await prisma.employeeTaskAssignment.create({
            data: {
                employee_id: employee.id,
                assigned_by_id: profile.id,
                task_id: task.id,
                title: "Referenced",
                due_at: new Date(),
                idempotency_key: crypto.randomUUID(),
            },
        });

        try {
            await expect(TaskService.remove(task.id)).rejects.toBeInstanceOf(AppError);
            // and it's still there
            expect(await prisma.tasks.findUnique({ where: { id: task.id } })).not.toBeNull();
        } finally {
            await prisma.employeeTaskAssignment.delete({ where: { id: assignment.id } });
            await prisma.employees.delete({ where: { id: employee.id } });
            await prisma.profiles.delete({ where: { id: profile.id } });
        }
    });

    test("an unreferenced task deletes cleanly", async () => {
        const task = await newTask("Deletable Task");
        await TaskService.remove(task.id);
        expect(await prisma.tasks.findUnique({ where: { id: task.id } })).toBeNull();
    });
});
