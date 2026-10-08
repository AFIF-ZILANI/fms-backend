import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { NotificationService } from "./notification.service";
import { TaskAssignmentService } from "./task-assignment.service";
import { passwordChanged } from "@lib/notification-messages";

const profileIds: string[] = [];
const employeeIds: string[] = [];
const taskIds: string[] = [];
let alice: string; // a worker
let bob: string; // someone else
let aliceEmployee: string;
let managerProfile: string;

const mobile = () => `+880${Math.floor(1e9 + Math.random() * 8e9)}`;

describe("NotificationService", () => {
    beforeAll(async () => {
        const make = async (name: string) => {
            const p = await prisma.profiles.create({
                data: { name, mobile: mobile(), role: "EMPLOYEE" },
            });
            profileIds.push(p.id);
            return p.id;
        };
        [alice, bob, managerProfile] = await Promise.all([
            make("Notif Alice"),
            make("Notif Bob"),
            make("Notif Manager"),
        ]);
        const e = await prisma.employees.create({
            data: { profile_id: alice, role: "WORKER", reference_salary: 15000 },
        });
        aliceEmployee = e.id;
        employeeIds.push(e.id);
    });

    afterAll(async () => {
        await prisma.employeeTaskAssignment.deleteMany({
            where: { employee_id: { in: employeeIds } },
        });
        await prisma.tasks.deleteMany({ where: { id: { in: taskIds } } });
        await prisma.employees.deleteMany({ where: { id: { in: employeeIds } } });
        // Notifications go with their profile (ON DELETE CASCADE), which is what this proves too.
        await prisma.profiles.deleteMany({ where: { id: { in: profileIds } } });
    });

    test("notify, list newest first, count unread", async () => {
        await NotificationService.notify(alice, { kind: "BONUS_GRANTED", title: "first" });
        await NotificationService.notify(alice, {
            kind: "POINTS_GIVEN",
            title: "second",
            body: "why",
        });
        const { notifications, meta } = await NotificationService.list(alice, {
            page: 1,
            limit: 20,
            status: "all",
        });
        expect(meta.total).toBe(2);
        expect(notifications.map((n) => n.title)).toEqual(["second", "first"]);
        expect(await NotificationService.unreadCount(alice)).toBe(2);
    });

    test("people only see their own", async () => {
        const mine = await NotificationService.list(bob, { page: 1, limit: 20, status: "all" });
        expect(mine.meta.total).toBe(0);
        expect(await NotificationService.unreadCount(bob)).toBe(0);
    });

    test("marking read: own works, someone else's is a 404, repeating is harmless", async () => {
        const { notifications } = await NotificationService.list(alice, {
            page: 1,
            limit: 20,
            status: "all",
        });
        const target = notifications[0]!;
        await expect(NotificationService.markRead(target.id, bob)).rejects.toBeInstanceOf(AppError);
        const read = await NotificationService.markRead(target.id, alice);
        expect(read.read_at).not.toBeNull();
        const again = await NotificationService.markRead(target.id, alice);
        expect(again.read_at?.getTime()).toBe(read.read_at!.getTime());
        expect(await NotificationService.unreadCount(alice)).toBe(1);
        const unread = await NotificationService.list(alice, {
            page: 1,
            limit: 20,
            status: "unread",
        });
        expect(unread.notifications).toHaveLength(1);
    });

    test("mark all read", async () => {
        await NotificationService.notify(alice, passwordChanged());
        const { updated } = await NotificationService.markAllRead(alice);
        expect(updated).toBe(2);
        expect(await NotificationService.unreadCount(alice)).toBe(0);
    });

    test("notify never throws, even for a profile that doesn't exist", async () => {
        await NotificationService.notify("00000000-0000-0000-0000-000000000000", passwordChanged());
    });

    test("assigning a task tells the assignee, but not when they assign it to themselves", async () => {
        const task = await prisma.tasks.create({
            data: { code: `NOTIF_${crypto.randomUUID().slice(0, 8)}`, label: "Notif task" },
        });
        taskIds.push(task.id);
        const base = {
            employee_id: aliceEmployee,
            task_id: task.id,
            title: "Weigh sample",
            due_at: new Date(Date.now() + 3_600_000),
        };

        const before = await NotificationService.unreadCount(alice);
        await TaskAssignmentService.create({ ...base, assigned_by_id: managerProfile } as never);
        expect(await NotificationService.unreadCount(alice)).toBe(before + 1);
        const latest = (await NotificationService.list(alice, { page: 1, limit: 1, status: "all" }))
            .notifications[0]!;
        expect(latest.kind).toBe("TASK_ASSIGNED");
        expect(latest.title).toBe("New task: Weigh sample");
        expect(latest.related_id).not.toBeNull();

        await TaskAssignmentService.create({ ...base, assigned_by_id: alice } as never);
        expect(await NotificationService.unreadCount(alice)).toBe(before + 1);
    });
});
