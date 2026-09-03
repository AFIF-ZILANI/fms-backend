import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { TaskAssignmentService } from "./task-assignment.service";
import { AppError } from "@lib/app-error";

const createdAssignmentIds: string[] = [];
let employeeId: string;
let managerProfileId: string;
let workerProfileId: string;
let taskId: string;
let taskTypeId: string;
let houseId: string;

async function newAssignment(overrides: Record<string, unknown> = {}) {
    const row = await TaskAssignmentService.create({
        employee_id: employeeId,
        assigned_by_id: managerProfileId,
        task_id: taskId,
        title: "Environment reading",
        due_at: new Date(),
        ...overrides,
    } as Parameters<typeof TaskAssignmentService.create>[0]);
    createdAssignmentIds.push(row.id);
    return row;
}

describe("TaskAssignmentService", () => {
    beforeAll(async () => {
        const suffix = crypto.randomUUID().slice(0, 8);
        const [manager, worker, house, type] = await Promise.all([
            prisma.profiles.create({
                data: {
                    name: "Task Manager",
                    mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                    role: "EMPLOYEE",
                },
            }),
            prisma.profiles.create({
                data: {
                    name: "Task Worker",
                    mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                    role: "EMPLOYEE",
                },
            }),
            prisma.houses.create({ data: { name: "Task House", type: "BROODER", number: 901 } }),
            prisma.taskType.create({
                data: { code: `ENVIRONMENT_${suffix}`, label: "Environment" },
            }),
        ]);
        managerProfileId = manager.id;
        workerProfileId = worker.id;
        houseId = house.id;
        taskTypeId = type.id;

        const employee = await prisma.employees.create({
            data: { profile_id: worker.id, role: "WORKER", salary: 15000 },
        });
        employeeId = employee.id;

        const task = await prisma.tasks.create({
            data: {
                code: `ENVIRONMENT_READING_${suffix}`,
                label: "Environment reading",
                task_type_id: type.id,
            },
        });
        taskId = task.id;
    });

    afterAll(async () => {
        await prisma.employeeTaskAssignment.deleteMany({
            where: { id: { in: createdAssignmentIds } },
        });
        await prisma.tasks.delete({ where: { id: taskId } });
        await prisma.taskType.delete({ where: { id: taskTypeId } });
        await prisma.employees.delete({ where: { id: employeeId } });
        await prisma.houses.delete({ where: { id: houseId } });
        await prisma.profiles.deleteMany({
            where: { id: { in: [managerProfileId, workerProfileId] } },
        });
    });

    test("create returns the task and its type so the app can route without an N+1", async () => {
        const row = await newAssignment({ house_id: houseId });
        expect(row.status).toBe("PENDING");
        expect(row.house_id).toBe(houseId);
        expect(row.task.task_type?.code).toContain("ENVIRONMENT");
        expect(row.employee.profile.name).toBe("Task Worker");
    });

    test("create defaults a missing idempotency_key rather than rejecting", async () => {
        const row = await newAssignment();
        expect(row.idempotency_key).toBeTruthy();
    });

    // The offline queue reuses one key across retries; the unique constraint is
    // what makes the retry safe, so a replay must conflict rather than duplicate.
    test("reusing an idempotency_key conflicts instead of double-inserting", async () => {
        const key = crypto.randomUUID();
        await newAssignment({ idempotency_key: key });
        await expect(newAssignment({ idempotency_key: key })).rejects.toBeInstanceOf(AppError);

        const count = await prisma.employeeTaskAssignment.count({
            where: { idempotency_key: key },
        });
        expect(count).toBe(1);
    });

    test("a task with no house carries a location note instead", async () => {
        const row = await newAssignment({
            title: "Fix water line",
            location_note: "front gate",
        });
        expect(row.house_id).toBeNull();
        expect(row.location_note).toBe("front gate");
    });

    // Replay tolerance: the mobile client queues complete() offline and resends
    // when a response is lost. A second call has to look like success, or a
    // finished task dead-letters and the worker is told their work failed.
    test("completing twice is idempotent and returns the same row", async () => {
        const row = await newAssignment();

        const first = await TaskAssignmentService.complete(row.id, { completion_note: "done" });
        expect(first.status).toBe("DONE");
        expect(first.completed_at).not.toBeNull();

        const replay = await TaskAssignmentService.complete(row.id, {});
        expect(replay.id).toBe(first.id);
        expect(replay.status).toBe("DONE");
        expect(replay.completed_at?.getTime()).toBe(first.completed_at?.getTime());
        expect(replay.completion_note).toBe("done");
    });

    test("cancelling twice is idempotent", async () => {
        const row = await newAssignment();
        const first = await TaskAssignmentService.cancel(row.id);
        expect(first.status).toBe("CANCELLED");

        const replay = await TaskAssignmentService.cancel(row.id);
        expect(replay.status).toBe("CANCELLED");
    });

    test("a cancelled task cannot be completed", async () => {
        const row = await newAssignment();
        await TaskAssignmentService.cancel(row.id);
        await expect(TaskAssignmentService.complete(row.id, {})).rejects.toBeInstanceOf(AppError);
    });

    test("a done task cannot be cancelled", async () => {
        const row = await newAssignment();
        await TaskAssignmentService.complete(row.id, {});
        await expect(TaskAssignmentService.cancel(row.id)).rejects.toBeInstanceOf(AppError);
    });

    test("editing a house-bound task to a location note clears the house", async () => {
        const row = await newAssignment({ house_id: houseId });

        const moved = await TaskAssignmentService.update(row.id, { location_note: "back shed" });
        expect(moved.location_note).toBe("back shed");
        expect(moved.house_id).toBeNull();

        const returned = await TaskAssignmentService.update(row.id, { house_id: houseId });
        expect(returned.house_id).toBe(houseId);
        expect(returned.location_note).toBeNull();
    });

    test("a completed task can no longer be edited", async () => {
        const row = await newAssignment();
        await TaskAssignmentService.complete(row.id, {});
        await expect(
            TaskAssignmentService.update(row.id, { title: "Too late" }),
        ).rejects.toBeInstanceOf(AppError);
    });

    test("getAll filters by employee, status and due range", async () => {
        const pending = await newAssignment({ due_at: new Date("2026-09-03T09:00:00Z") });
        const done = await newAssignment({ due_at: new Date("2026-09-03T11:00:00Z") });
        await TaskAssignmentService.complete(done.id, {});

        const { rows } = await TaskAssignmentService.getAll({
            employee_id: employeeId,
            status: "PENDING",
            due_from: new Date("2026-09-03T00:00:00Z"),
            due_to: new Date("2026-09-03T23:59:59Z"),
            page: 1,
            limit: 100,
        });

        expect(rows.some((r) => r.id === pending.id)).toBe(true);
        expect(rows.some((r) => r.id === done.id)).toBe(false);
        expect(rows.every((r) => r.status === "PENDING")).toBe(true);
    });

    test("getById on a missing assignment is a not-found", async () => {
        await expect(TaskAssignmentService.getById(crypto.randomUUID())).rejects.toBeInstanceOf(
            AppError,
        );
    });
});
