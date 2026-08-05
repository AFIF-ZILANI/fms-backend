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
});
