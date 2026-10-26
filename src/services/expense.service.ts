import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type {
    CreateExpenseInput,
    ExpenseSummaryQuery,
    ListExpensesQuery,
} from "@validators/expense.validator";
import {
    PAYROLL_EXPENSE_CATEGORIES,
    recordPaidAtCreate,
    requirePaidInstrument,
} from "@lib/paid-at-create";
import { Prisma } from "../../prisma/generated/prisma/client";

// Append-only, same as Purchase/Sale/Payment -- every money-movement table
// in this system is create-only. A correction is a new offsetting entry.
function expenseWhere(query: ExpenseSummaryQuery) {
    return {
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
}

export const ExpenseService = {
    /** Totals for the whole filtered set (not one page): amounts by cost type, paid vs still owed, and by
     * category. Payroll's own expenses are paid through their payout, so they never count as owed. */
    async summary(query: ExpenseSummaryQuery) {
        const where = expenseWhere(query);
        const [rows, labels] = await Promise.all([
            prisma.expense.findMany({
                where,
                select: { id: true, amount: true, cost_type: true, category: true },
            }),
            prisma.expenseCategoryLookup.findMany({ select: { code: true, label: true } }),
        ]);
        const paid = await prisma.payment.groupBy({
            by: ["ref_id"],
            where: { ref_type: "EXPENSE", ref_id: { in: rows.map((r) => r.id) } },
            _sum: { amount: true },
        });
        const paidBy = new Map(paid.map((p) => [p.ref_id, Number(p._sum.amount ?? 0)]));
        const label = new Map(labels.map((l) => [l.code, l.label]));
        const r2 = (v: number) => Math.round(v * 100) / 100;
        const out = {
            count: rows.length,
            total: 0,
            direct: 0,
            shared: 0,
            capital: 0,
            stock: 0,
            paid: 0,
            unpaid: 0,
        };
        const byCategory = new Map<string, number>();
        for (const r of rows) {
            const amount = Number(r.amount);
            out.total += amount;
            if (r.cost_type === "DIRECT") out.direct += amount;
            else if (r.cost_type === "SHARED_PERIOD") out.shared += amount;
            else if (r.cost_type === "STOCK") out.stock += amount;
            else out.capital += amount;
            if (PAYROLL_EXPENSE_CATEGORIES.includes(r.category)) out.paid += amount;
            else {
                const p = Math.min(amount, paidBy.get(r.id) ?? 0);
                out.paid += p;
                out.unpaid += amount - p;
            }
            byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + amount);
        }
        return {
            count: out.count,
            total: r2(out.total),
            direct: r2(out.direct),
            shared: r2(out.shared),
            capital: r2(out.capital),
            // Purchase charges: real money out (and owed), but costed through stock, not as an expense.
            stock: r2(out.stock),
            paid: r2(out.paid),
            unpaid: r2(out.unpaid),
            by_category: [...byCategory.entries()]
                .map(([code, amount]) => ({
                    code,
                    label: label.get(code) ?? code,
                    amount: r2(amount),
                }))
                .sort((a, b) => b.amount - a.amount),
        };
    },

    async getAll(query: ListExpensesQuery) {
        const where = expenseWhere(query);
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
        checkExpensePaid(data);
        try {
            return await prisma.$transaction((tx) => writeExpense(tx, data));
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },
};

/** An expense as written -- the API's create body, or a purchase's own charge (cost_type STOCK). */
export type ExpenseWrite = Omit<CreateExpenseInput, "cost_type"> & {
    cost_type: CreateExpenseInput["cost_type"] | "STOCK";
    purchase_id?: string;
};

/** Fail before any write: payroll expenses are paid by their payout; paid money names its account. */
export function checkExpensePaid(data: Pick<ExpenseWrite, "category" | "paid_amount" | "paid_from_instrument_id">) {
    const paid = new Prisma.Decimal(data.paid_amount ?? 0);
    if (paid.greaterThan(0) && PAYROLL_EXPENSE_CATEGORIES.includes(data.category)) {
        throw AppError.badRequest(
            "Salary and bonus expenses are paid through their payout, not a payment",
        );
    }
    requirePaidInstrument(paid, data.paid_from_instrument_id, "paid_from_instrument_id", "EXPENSE");
}

/** The Expense row and its paid-at-create Payment, inside the caller's transaction. */
export async function writeExpense(tx: Prisma.TransactionClient, data: ExpenseWrite) {
    const expense = await tx.expense.create({
        data: {
            category: data.category,
            cost_type: data.cost_type,
            amount: data.amount,
            date: data.date,
            recorded_by_id: data.recorded_by_id,
            ...(data.batch_id !== undefined && { batch_id: data.batch_id }),
            ...(data.purchase_id !== undefined && { purchase_id: data.purchase_id }),
            ...(data.remarks !== undefined && { remarks: data.remarks }),
        },
    });
    await recordPaidAtCreate(tx, {
        ref_type: "EXPENSE",
        ref_id: expense.id,
        amount: new Prisma.Decimal(data.paid_amount ?? 0),
        instrument_id: data.paid_from_instrument_id,
        date: data.date,
        actor_id: data.recorded_by_id,
    });
    return expense;
}
