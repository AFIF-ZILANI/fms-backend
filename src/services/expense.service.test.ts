import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { ExpenseService } from "./expense.service";
import { AppError } from "@lib/app-error";

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
            cost_type: "DIRECT",
            amount: 1200,
            date: new Date(),
            recorded_by_id: profileId,
        });
        createdIds.push(expense!.id);

        const { expenses } = await ExpenseService.getAll({
            page: 1,
            limit: 100,
            cost_type: "DIRECT",
        });
        expect(expenses.some((e) => e.id === expense!.id)).toBe(true);
        expect(expenses.every((e) => e.cost_type === "DIRECT")).toBe(true);
    });

    test("listing filters by date range", async () => {
        const inRange = await ExpenseService.create({
            category: "FUEL",
            cost_type: "DIRECT",
            amount: 800,
            date: new Date("2026-03-15"),
            recorded_by_id: profileId,
        });
        createdIds.push(inRange!.id);
        const outOfRange = await ExpenseService.create({
            category: "FUEL",
            cost_type: "DIRECT",
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
            cost_type: "DIRECT",
            amount: 700,
            date: new Date("2026-05-01"),
            recorded_by_id: profileId,
        });
        createdIds.push(recent!.id);
        const old = await ExpenseService.create({
            category: "FUEL",
            cost_type: "DIRECT",
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
            cost_type: "DIRECT",
            amount: 750,
            date: new Date("2026-05-01"),
            recorded_by_id: profileId,
        });
        createdIds.push(recent!.id);
        const old = await ExpenseService.create({
            category: "FUEL",
            cost_type: "DIRECT",
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
});
