import { describe, test, expect, afterAll } from "bun:test";
import prisma from "@lib/db";
import { AlertService } from "./alert.service";
import { AppError } from "@lib/app-error";
import { houseNumber } from "@lib/test-fixtures";

const createdAlertIds: string[] = [];
const createdItemIds: string[] = [];
const createdBatchIds: string[] = [];
const createdHouseIds: string[] = [];
const createdProfileIds: string[] = [];
const createdEmployeeIds: string[] = [];

describe("AlertService", () => {
    afterAll(async () => {
        await prisma.alerts.deleteMany({
            where: { OR: [{ id: { in: createdAlertIds } }, { related_id: { in: createdEmployeeIds } }] },
        });
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
            data: { name: "Scan House", type: "BROODER", number: houseNumber() },
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
            data: { profile_id: profile.id, role: "WORKER", reference_salary: 10000 },
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
                incident_date: new Date(),
                notice_doc_url: "https://example.com/notice", // -4 or worse needs written notice first
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
                incident_date: new Date(),
                idempotency_key: crypto.randomUUID(),
            },
        });

        await AlertService.runScan();
        // Queried directly rather than via AlertService.getAll: the dev database
        // can hold far more than one page of stale ACTIVE EMPLOYEE alerts, and this
        // assertion must hold regardless of how many alerts already exist.
        const match = await prisma.alerts.findFirst({
            where: {
                related_id: employee.id,
                type: "EMPLOYEE",
                status: "ACTIVE",
                level: "WARNING",
            },
        });
        expect(match).toBeDefined();
        createdAlertIds.push(match!.id);
    });

    test("scan warns when a probation has already ended", async () => {
        const profile = await prisma.profiles.create({
            data: {
                name: "Probation Scan",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "EMPLOYEE",
            },
        });
        createdProfileIds.push(profile.id);
        const employee = await prisma.employees.create({
            data: {
                profile_id: profile.id,
                role: "WORKER",
                reference_salary: 10000,
                employment_status: "PROBATION",
                // Yesterday -- past due, so this escalates to WARNING.
                probation_end_date: new Date(Date.now() - 86_400_000),
            },
        });
        createdEmployeeIds.push(employee.id);

        await AlertService.runScan();
        const { alerts } = await AlertService.getAll({
            page: 1,
            limit: 100,
            type: "EMPLOYEE",
            status: "ACTIVE",
        });
        const match = alerts.find(
            (a) => a.related_id === employee.id && a.title.includes("probation ended"),
        );
        expect(match).toBeDefined();
        expect(match!.level).toBe("WARNING");
        createdAlertIds.push(match!.id);
    });

    test("scan leaves a probation that is still far off alone", async () => {
        const profile = await prisma.profiles.create({
            data: {
                name: "Probation Far",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "EMPLOYEE",
            },
        });
        createdProfileIds.push(profile.id);
        const employee = await prisma.employees.create({
            data: {
                profile_id: profile.id,
                role: "WORKER",
                reference_salary: 10000,
                employment_status: "PROBATION",
                probation_end_date: new Date(Date.now() + 60 * 86_400_000),
            },
        });
        createdEmployeeIds.push(employee.id);

        await AlertService.runScan();
        const { alerts } = await AlertService.getAll({
            page: 1,
            limit: 100,
            type: "EMPLOYEE",
            status: "ACTIVE",
        });
        expect(alerts.some((a) => a.related_id === employee.id && a.title.includes("probation"))).toBe(
            false,
        );
    });

    /** An active, probation-overdue employee with a bad month: two separate conditions at once. None of
     * the checks involved depend on the day of the month. */
    async function newTroubledEmployee() {
        const profile = await prisma.profiles.create({
            data: { name: "Two Conditions", mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`, role: "EMPLOYEE" },
        });
        createdProfileIds.push(profile.id);
        const employee = await prisma.employees.create({
            data: {
                profile_id: profile.id,
                role: "WORKER",
                reference_salary: 10000,
                employment_status: "PROBATION",
                probation_end_date: new Date(Date.now() - 86_400_000), // yesterday: overdue
            },
        });
        createdEmployeeIds.push(employee.id);
        const giver = await prisma.profiles.create({
            data: { name: "Two Giver", mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`, role: "ADMIN" },
        });
        createdProfileIds.push(giver.id);
        await prisma.performanceScoreEntry.create({
            data: {
                employee_id: employee.id,
                given_by_id: giver.id,
                criterion: "NEGLIGENT_LOSS",
                points: -5,
                reason: "two conditions",
                incident_date: new Date(),
                notice_doc_url: "https://example.com/notice",
                idempotency_key: crypto.randomUUID(),
            },
        });
        return employee;
    }

    const activeFor = (employeeId: string) =>
        prisma.alerts.findMany({ where: { related_id: employeeId, status: "ACTIVE" }, orderBy: { dedupe_key: "asc" } });

    test("two conditions about one employee each get their own alert (neither hides the other)", async () => {
        const employee = await newTroubledEmployee();
        await AlertService.runScan();

        const keys = (await activeFor(employee.id)).map((a) => a.dedupe_key);
        // Under the old (type, related_id) dedupe only whichever the parallel checks raised first existed.
        expect(keys).toContain(`NEG_PERF:${employee.id}`);
        expect(keys).toContain(`PROBATION:${employee.id}`);
    });

    test("overlapping scans raise each condition once", async () => {
        const employee = await newTroubledEmployee();
        await Promise.all([AlertService.runScan(), AlertService.runScan(), AlertService.runScan()]);

        const keys = (await activeFor(employee.id)).map((a) => a.dedupe_key);
        expect(new Set(keys).size).toBe(keys.length); // no condition twice
        expect(keys).toContain(`NEG_PERF:${employee.id}`);
    });

    test("resolving an alert lets the next scan raise the condition again", async () => {
        const employee = await newTroubledEmployee();
        await AlertService.runScan();
        const first = (await activeFor(employee.id)).find((a) => a.dedupe_key === `NEG_PERF:${employee.id}`)!;

        await prisma.alerts.update({ where: { id: first.id }, data: { status: "RESOLVED" } });
        await AlertService.runScan();

        const again = (await activeFor(employee.id)).find((a) => a.dedupe_key === `NEG_PERF:${employee.id}`);
        expect(again).toBeDefined();
        expect(again!.id).not.toBe(first.id);
    });

    test("a repeat scan finds the existing alert instead of adding another", async () => {
        const employee = await newTroubledEmployee();
        await AlertService.runScan();
        const before = (await activeFor(employee.id)).length;
        await AlertService.runScan();
        expect((await activeFor(employee.id)).length).toBe(before);
    });
});
