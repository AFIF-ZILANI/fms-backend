import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type { CreateExpenseInput, ListExpensesQuery } from "@validators/expense.validator";

// Append-only, same as Purchase/Sale/Payment -- every money-movement table
// in this system is create-only. A correction is a new offsetting entry.
export const ExpenseService = {
    async getAll(query: ListExpensesQuery) {
        const where = {
            ...(query.batch_id !== undefined && { batch_id: query.batch_id }),
            ...(query.category !== undefined && { category: query.category }),
            ...(query.cost_type !== undefined && { cost_type: query.cost_type }),
        };
        const [expenses, total] = await Promise.all([
            prisma.expense.findMany({
                where,
                orderBy: { date: "desc" },
                ...toSkipTake(query),
            }),
            prisma.expense.count({ where }),
        ]);
        return { expenses, meta: buildMeta(total, query) };
    },

    async getById(id: string) {
        const expense = await prisma.expense.findUnique({ where: { id } });
        if (!expense) throw AppError.notFound("Expense");
        return expense;
    },

    async create(data: CreateExpenseInput) {
        try {
            return await prisma.expense.create({
                data: {
                    category: data.category,
                    cost_type: data.cost_type,
                    amount: data.amount,
                    date: data.date,
                    recorded_by_id: data.recorded_by_id,
                    ...(data.batch_id !== undefined && { batch_id: data.batch_id }),
                    ...(data.remarks !== undefined && { remarks: data.remarks }),
                },
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },
};
