import { describe, test, expect, afterAll } from "bun:test";
import prisma from "@lib/db";
import { AlertService } from "./alert.service";
import { AppError } from "@lib/app-error";

const createdAlertIds: string[] = [];
const createdItemIds: string[] = [];
const createdBatchIds: string[] = [];
const createdHouseIds: string[] = [];
const createdProfileIds: string[] = [];
const createdEmployeeIds: string[] = [];

describe("AlertService", () => {
    afterAll(async () => {
        await prisma.alerts.deleteMany({ where: { id: { in: createdAlertIds } } });
        await prisma.stockLedger.deleteMany({ where: { item_id: { in: createdItemIds } } });
        await prisma.item.deleteMany({ where: { id: { in: createdItemIds } } });
        await prisma.mortalityLog.deleteMany({ where: { batch_id: { in: createdBatchIds } } });
        await prisma.batchHouseBalance.deleteMany({ where: { batch_id: { in: createdBatchIds } } });
        await prisma.batchHouseAllocation.deleteMany({
            where: { batch_id: { in: createdBatchIds } },
        });
        await prisma.batches.deleteMany({ where: { id: { in: createdBatchIds } } });
        await prisma.houses.deleteMany({ where: { id: { in: createdHouseIds } } });
        await prisma.performanceScoreEntry.deleteMany({
            where: { employee_id: { in: createdEmployeeIds } },
        });
        await prisma.employees.deleteMany({ where: { id: { in: createdEmployeeIds } } });
        await prisma.profiles.deleteMany({ where: { id: { in: createdProfileIds } } });
    });

    test("manual create then resolve", async () => {
        const alert = await AlertService.create({
            title: "Manual system alert",
            type: "SYSTEM",
            level: "INFO",
        });
        createdAlertIds.push(alert.id);
        expect(alert.status).toBe("ACTIVE");

        const resolved = await AlertService.resolve(alert.id);
        expect(resolved.status).toBe("RESOLVED");
        expect(resolved.resolved_at).not.toBeNull();
    });

    test("resolving an already-resolved alert throws a conflict", async () => {
        const alert = await AlertService.create({ title: "Once", type: "SYSTEM", level: "INFO" });
        createdAlertIds.push(alert.id);
        await AlertService.resolve(alert.id);

        await expect(AlertService.resolve(alert.id)).rejects.toMatchObject({ status: 409 });
    });

    test("getById on unknown id throws not-found", async () => {
        await expect(
            AlertService.getById("00000000-0000-0000-0000-000000000000"),
        ).rejects.toBeInstanceOf(AppError);
    });

    test("scan raises a low-stock alert and doesn't duplicate it on a second run", async () => {
        const item = await prisma.item.create({
            data: {
                name: `Scan Feed ${crypto.randomUUID()}`,
                normalized_key: `scan feed ${crypto.randomUUID()}`,
                category: "FEED",
                unit: "BAG",
                reorder_level: 50,
            },
        });
        createdItemIds.push(item.id);
        // opening balance of 10, well below reorder_level 50
        await prisma.stockLedger.create({
            data: {
                item_id: item.id,
                quantity: 10,
                direction: "IN",
                reason: "OPENING_BALANCE",
                ref_type: "ADJUSTMENT",
                ref_id: crypto.randomUUID(),
                idempotency_key: crypto.randomUUID(),
            },
        });

        await AlertService.runScan();
        const { alerts: firstPass } = await AlertService.getAll({
            page: 1,
            limit: 50,
            type: "FEED",
            status: "ACTIVE",
        });
        const match = firstPass.find((a) => a.related_id === item.id);
        expect(match).toBeDefined();
        createdAlertIds.push(match!.id);

        await AlertService.runScan();
        const { alerts: secondPass } = await AlertService.getAll({
            page: 1,
            limit: 50,
            type: "FEED",
            status: "ACTIVE",
        });
        const matchesAfterRescan = secondPass.filter((a) => a.related_id === item.id);
        expect(matchesAfterRescan.length).toBe(1); // still just one, not duplicated
    });

    test("scan raises a critical mortality alert when the 24h rate exceeds 1%", async () => {
        const house = await prisma.houses.create({
            data: { name: "Scan House", type: "BROODER", number: 9001 },
        });
        createdHouseIds.push(house.id);
        const profile = await prisma.profiles.create({
            data: {
                name: "Scan Recorder",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "ADMIN",
            },
        });
        createdProfileIds.push(profile.id);
        const batch = await prisma.batches.create({
            data: {
                batch_code: `SCAN-${crypto.randomUUID()}`,
                breed: "CLASSIC",
                expected_selling_date: new Date(Date.now() + 30 * 86400_000),
                initial_chick_count: 100,
                init_chicks_avg_wt: 40,
            },
        });
        createdBatchIds.push(batch.id);
        await prisma.batchHouseBalance.create({
            data: { batch_id: batch.id, house_id: house.id, quantity: 100 },
        });
        // 5 deaths out of 100 live = 5% > 1% threshold
        await prisma.mortalityLog.create({
            data: {
                batch_id: batch.id,
                house_id: house.id,
                count_died: 5,
                date: new Date(),
                recorded_by_id: profile.id,
                idempotency_key: crypto.randomUUID(),
            },
        });

        await AlertService.runScan();
        const { alerts } = await AlertService.getAll({
            page: 1,
            limit: 50,
            type: "BATCH",
            status: "ACTIVE",
        });
        const match = alerts.find((a) => a.related_id === batch.id);
        expect(match).toBeDefined();
        expect(match!.level).toBe("CRITICAL");
        createdAlertIds.push(match!.id);
    });

    test("scan raises a negative-performance-pattern alert for a bad month", async () => {
        const profile = await prisma.profiles.create({
            data: {
                name: "Scan Employee",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "EMPLOYEE",
            },
        });
        createdProfileIds.push(profile.id);
        const employee = await prisma.employees.create({
            data: { profile_id: profile.id, role: "WORKER", salary: 10000 },
        });
        createdEmployeeIds.push(employee.id);
        const giver = await prisma.profiles.create({
            data: {
                name: "Scan Giver",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "ADMIN",
            },
        });
        createdProfileIds.push(giver.id);

        await prisma.performanceScoreEntry.create({
            data: {
                employee_id: employee.id,
                given_by_id: giver.id,
                criterion: "NEGLIGENT_LOSS",
                points: -5,
                reason: "scan test",
                idempotency_key: crypto.randomUUID(),
            },
        });
        await prisma.performanceScoreEntry.create({
            data: {
                employee_id: employee.id,
                given_by_id: giver.id,
                criterion: "UNEXCUSED_ABSENCE",
                points: -2,
                reason: "scan test",
                idempotency_key: crypto.randomUUID(),
            },
        });

        await AlertService.runScan();
        const { alerts } = await AlertService.getAll({
            page: 1,
            limit: 50,
            type: "EMPLOYEE",
            status: "ACTIVE",
        });
        const match = alerts.find((a) => a.related_id === employee.id && a.level === "WARNING");
        expect(match).toBeDefined();
        createdAlertIds.push(match!.id);
    });
});
