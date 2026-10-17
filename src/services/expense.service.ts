import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type { CreateExpenseInput, ListExpensesQuery } from "@validators/expense.validator";
import {
    PAYROLL_EXPENSE_CATEGORIES,
    recordPaidAtCreate,
    requirePaidInstrument,
} from "@lib/paid-at-create";
import { Prisma } from "../../prisma/generated/prisma/client";

// Append-only, same as Purchase/Sale/Payment -- every money-movement table
// in this system is create-only. A correction is a new offsetting entry.
export const ExpenseService = {
    async getAll(query: ListExpensesQuery) {
        const where = {
            ...(query.batch_id !== undefined && { batch_id: query.batch_id }),
            ...(query.category !== undefined && { category: query.category }),
            ...(query.cost_type !== undefined && { cost_type: query.cost_type }),
            ...((query.date_from !== undefined || query.date_to !== undefined) && {
                date: {
                    ...(query.date_from !== undefined && { gte: query.date_from }),
                    ...(query.date_to !== undefined && { lte: query.date_to }),
                },
            }),
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

    /** The expense and, when something was paid, its Payment -- one transaction, so the cost and the
     * money leaving an account are never recorded one without the other. */
    async create(data: CreateExpenseInput) {
        const paid = new Prisma.Decimal(data.paid_amount ?? 0);
        if (paid.greaterThan(0) && PAYROLL_EXPENSE_CATEGORIES.includes(data.category)) {
            throw AppError.badRequest(
                "Salary and bonus expenses are paid through their payout, not a payment",
            );
        }
        requirePaidInstrument(
            paid,
            data.paid_from_instrument_id,
            "paid_from_instrument_id",
            "EXPENSE",
        );
        try {
            return await prisma.$transaction(async (tx) => {
                const expense = await tx.expense.create({
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
                await recordPaidAtCreate(tx, {
                    ref_type: "EXPENSE",
                    ref_id: expense.id,
                    amount: paid,
                    instrument_id: data.paid_from_instrument_id,
                    date: data.date,
                    actor_id: data.recorded_by_id,
                });
                return expense;
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },
};
