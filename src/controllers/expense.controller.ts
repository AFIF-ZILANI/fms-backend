import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { ExpenseService } from "@services/expense.service";
import type { CreateExpenseInput, ListExpensesQuery } from "@validators/expense.validator";

export const ExpenseController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListExpensesQuery>(c, "query");
            const { expenses, meta } = await ExpenseService.getAll(query);
            return sendList(c, expenses, meta, "Expenses fetched successfully");
        });
    },

    async getById(c: Context) {
        return withHandler(c, async () => {
            const expense = await ExpenseService.getById(c.req.param("id") ?? "");
            return sendSuccess(c, expense, "Expense fetched successfully");
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<CreateExpenseInput>(c, "json");
            const expense = await ExpenseService.create(body);
            return sendSuccess(c, expense, "Expense recorded", 201);
        });
    },
};
