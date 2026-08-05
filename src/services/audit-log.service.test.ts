import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { AuditLogService } from "./audit-log.service";
import { AppError } from "@lib/app-error";

let profileId: string;
const createdIds: string[] = [];

describe("AuditLogService", () => {
    beforeAll(async () => {
        const profile = await prisma.profiles.create({
            data: {
                name: "Audit Actor",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "ADMIN",
            },
        });
        profileId = profile.id;

        const entries = await prisma.$transaction([
            prisma.auditLog.create({
                data: {
                    table_name: "Item",
                    record_id: crypto.randomUUID(),
                    action: "CREATE",
                    changed_by_id: profileId,
                    after_data: { name: "New Item" },
                },
            }),
            prisma.auditLog.create({
                data: {
                    table_name: "Item",
                    record_id: crypto.randomUUID(),
                    action: "UPDATE",
                    changed_by_id: profileId,
                    before_data: { reorder_level: 10 },
                    after_data: { reorder_level: 20 },
                },
            }),
            prisma.auditLog.create({
                data: {
                    table_name: "Batches",
                    record_id: crypto.randomUUID(),
                    action: "UPDATE",
                    changed_by_id: profileId,
                    before_data: { status: "RUNNING" },
                    after_data: { status: "CLOSED" },
                },
            }),
        ]);
        createdIds.push(...entries.map((e) => e.id));
    });

    afterAll(async () => {
        await prisma.auditLog.deleteMany({ where: { id: { in: createdIds } } });
        await prisma.profiles.delete({ where: { id: profileId } });
    });

    test("filters by table_name", async () => {
        const { logs } = await AuditLogService.getAll({ page: 1, limit: 50, table_name: "Item" });
        expect(logs.length).toBeGreaterThanOrEqual(2);
        expect(logs.every((l) => l.table_name === "Item")).toBe(true);
    });

    test("filters by action", async () => {
        const { logs } = await AuditLogService.getAll({ page: 1, limit: 50, action: "CREATE" });
        expect(logs.some((l) => l.id === createdIds[0])).toBe(true);
        expect(logs.every((l) => l.action === "CREATE")).toBe(true);
    });

    test("filters by changed_by_id", async () => {
        const { logs } = await AuditLogService.getAll({
            page: 1,
            limit: 50,
            changed_by_id: profileId,
        });
        expect(logs.length).toBeGreaterThanOrEqual(3);
    });

    test("getById returns before/after JSON diff", async () => {
        const log = await AuditLogService.getById(createdIds[1]!);
        expect(log.before_data).toEqual({ reorder_level: 10 });
        expect(log.after_data).toEqual({ reorder_level: 20 });
    });

    test("getById on unknown id throws not-found", async () => {
        await expect(
            AuditLogService.getById("00000000-0000-0000-0000-000000000000"),
        ).rejects.toBeInstanceOf(AppError);
    });
});
