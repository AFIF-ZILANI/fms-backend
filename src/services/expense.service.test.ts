import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { ExpenseService } from "./expense.service";
import { AppError } from "@lib/app-error";
import { createExpenseSchema } from "@validators/expense.validator";

let profileId: string;
const createdIds: string[] = [];

describe("ExpenseService", () => {
    beforeAll(async () => {
        const profile = await prisma.profiles.create({
            data: {
                name: "Expense Recorder",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "ADMIN",
            },
        });
        profileId = profile.id;
    });

    afterAll(async () => {
        await prisma.expense.deleteMany({ where: { id: { in: createdIds } } });
        await prisma.profiles.delete({ where: { id: profileId } });
    });

    test("create then getById round-trips", async () => {
        const expense = await ExpenseService.create({
            category: "ELECTRICITY",
            cost_type: "SHARED_PERIOD",
            amount: 4500,
            date: new Date(),
            recorded_by_id: profileId,
        });
        createdIds.push(expense!.id);

        const found = await ExpenseService.getById(expense!.id);
        expect(found.category).toBe("ELECTRICITY");
        expect(found.cost_type).toBe("SHARED_PERIOD");
        expect(found.amount.toNumber()).toBe(4500);
    });

    test("getById on unknown id throws not-found", async () => {
        await expect(
            ExpenseService.getById("00000000-0000-0000-0000-000000000000"),
        ).rejects.toBeInstanceOf(AppError);
    });

    test("listing filters by cost_type", async () => {
        const expense = await ExpenseService.create({
            category: "VET_FEE",
            cost_type: "SHARED_CAPITAL",
            amount: 1200,
            date: new Date(),
            recorded_by_id: profileId,
        });
        createdIds.push(expense!.id);

        const { expenses } = await ExpenseService.getAll({
            page: 1,
            limit: 100,
            cost_type: "SHARED_CAPITAL",
        });
        expect(expenses.some((e) => e.id === expense!.id)).toBe(true);
        expect(expenses.every((e) => e.cost_type === "SHARED_CAPITAL")).toBe(true);
    });

    test("listing filters by date range", async () => {
        const inRange = await ExpenseService.create({
            category: "FUEL",
            cost_type: "SHARED_CAPITAL",
            amount: 800,
            date: new Date("2026-03-15"),
            recorded_by_id: profileId,
        });
        createdIds.push(inRange!.id);
        const outOfRange = await ExpenseService.create({
            category: "FUEL",
            cost_type: "SHARED_CAPITAL",
            amount: 900,
            date: new Date("2026-06-01"),
            recorded_by_id: profileId,
        });
        createdIds.push(outOfRange!.id);

        const { expenses } = await ExpenseService.getAll({
            page: 1,
            limit: 100,
            date_from: new Date("2026-03-01"),
            date_to: new Date("2026-03-31"),
        });
        expect(expenses.some((e) => e.id === inRange!.id)).toBe(true);
        expect(expenses.some((e) => e.id === outOfRange!.id)).toBe(false);
    });

    test("listing filters by date_from alone (no upper bound)", async () => {
        const recent = await ExpenseService.create({
            category: "FUEL",
            cost_type: "SHARED_CAPITAL",
            amount: 700,
            date: new Date("2026-05-01"),
            recorded_by_id: profileId,
        });
        createdIds.push(recent!.id);
        const old = await ExpenseService.create({
            category: "FUEL",
            cost_type: "SHARED_CAPITAL",
            amount: 600,
            date: new Date("2026-01-01"),
            recorded_by_id: profileId,
        });
        createdIds.push(old!.id);

        const { expenses } = await ExpenseService.getAll({
            page: 1,
            limit: 100,
            date_from: new Date("2026-04-01"),
        });
        expect(expenses.some((e) => e.id === recent!.id)).toBe(true);
        expect(expenses.some((e) => e.id === old!.id)).toBe(false);
    });

    test("listing filters by date_to alone (no lower bound)", async () => {
        const recent = await ExpenseService.create({
            category: "FUEL",
            cost_type: "SHARED_CAPITAL",
            amount: 750,
            date: new Date("2026-05-01"),
            recorded_by_id: profileId,
        });
        createdIds.push(recent!.id);
        const old = await ExpenseService.create({
            category: "FUEL",
            cost_type: "SHARED_CAPITAL",
            amount: 650,
            date: new Date("2026-01-01"),
            recorded_by_id: profileId,
        });
        createdIds.push(old!.id);

        const { expenses } = await ExpenseService.getAll({
            page: 1,
            limit: 100,
            date_to: new Date("2026-02-01"),
        });
        expect(expenses.some((e) => e.id === old!.id)).toBe(true);
        expect(expenses.some((e) => e.id === recent!.id)).toBe(false);
    });

    test("a DIRECT cost needs a batch -- refused by the validator and by the database", async () => {
        const base = { category: "TRANSPORT", cost_type: "DIRECT", amount: 100, date: "2027-01-05" };
        expect(createExpenseSchema.safeParse(base).success).toBe(false);
        expect(createExpenseSchema.safeParse({ ...base, batch_id: crypto.randomUUID() }).success).toBe(true);
        expect(createExpenseSchema.safeParse({ ...base, cost_type: "SHARED_PERIOD" }).success).toBe(true);

        // A script or a future service that skips the validator still can't write one.
        await expect(
            (async () =>
                prisma.expense.create({
                    data: { category: "TRANSPORT", cost_type: "DIRECT", amount: 100, date: new Date(), recorded_by_id: profileId },
                }))(),
        ).rejects.toThrow();

        const batch = await prisma.batches.create({
            data: {
                batch_code: `EXP-${crypto.randomUUID()}`,
                breed: "CLASSIC",
                expected_selling_date: new Date(Date.now() + 30 * 86400_000),
                initial_chick_count: 10,
                init_chicks_avg_wt: 40,
            },
        });
        try {
            const ok = await prisma.expense.create({
                data: { batch_id: batch.id, category: "TRANSPORT", cost_type: "DIRECT", amount: 100, date: new Date(), recorded_by_id: profileId },
            });
            createdIds.push(ok.id);
        } finally {
            await prisma.expense.deleteMany({ where: { batch_id: batch.id } });
            await prisma.batches.delete({ where: { id: batch.id } });
        }
    });
});
