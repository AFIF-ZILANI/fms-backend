import prisma from "@lib/db";
import { Prisma } from "../../prisma/generated/prisma/client";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type { CreatePaymentInput, ListPaymentsQuery } from "@validators/payment.validator";

type RefType = CreatePaymentInput["ref_type"];

const REF_LABEL: Record<RefType, string> = {
    SALE: "Sale",
    BIRD_SALE: "BirdSale",
    PURCHASE: "Purchase",
    EXPENSE: "Expense",
    PAYROLL: "PayrollRecord",
};

/** What a referenced record owes before any Payment rows are netted off.
 * Sale/BirdSale/Purchase carry a create-time `due_amount` snapshot; Expense
 * and PayrollRecord have none, so the whole amount is owed. Throws if the
 * ref doesn't exist -- ref_id is polymorphic with no FK behind it, so this
 * is the only thing standing between a typo and an orphaned payment. */
async function owedForRef(
    tx: Prisma.TransactionClient,
    ref_type: RefType,
    ref_id: string,
): Promise<Prisma.Decimal> {
    const owed = await (async () => {
        switch (ref_type) {
            case "SALE":
                return (
                    await tx.sale.findUnique({ where: { id: ref_id }, select: { due_amount: true } })
                )?.due_amount;
            case "BIRD_SALE":
                return (
                    await tx.birdSale.findUnique({
                        where: { id: ref_id },
                        select: { due_amount: true },
                    })
                )?.due_amount;
            case "PURCHASE":
                return (
                    await tx.purchase.findUnique({
                        where: { id: ref_id },
                        select: { due_amount: true },
                    })
                )?.due_amount;
            case "EXPENSE":
                return (
                    await tx.expense.findUnique({ where: { id: ref_id }, select: { amount: true } })
                )?.amount;
            case "PAYROLL":
                return (
                    await tx.payrollRecord.findUnique({
                        where: { id: ref_id },
                        select: { final_salary: true },
                    })
                )?.final_salary;
        }
    })();

    if (owed === undefined || owed === null) throw AppError.notFound(REF_LABEL[ref_type]);
    return owed;
}

async function outstandingWithin(
    tx: Prisma.TransactionClient,
    ref_type: RefType,
    ref_id: string,
): Promise<Prisma.Decimal> {
    const [owed, paid] = await Promise.all([
        owedForRef(tx, ref_type, ref_id),
        tx.payment.aggregate({ where: { ref_type, ref_id }, _sum: { amount: true } }),
    ]);
    return owed.minus(paid._sum.amount ?? new Prisma.Decimal(0));
}

// Payment is append-only, same as Purchase/Sale -- no update. due_amount on
// the referenced Purchase/Sale/BirdSale is a create-time snapshot and stays
// that way (those tables are append-only too); outstanding balance is
// computed by summing Payment rows against ref_id at read time, not by
// mutating the original row.
export const PaymentService = {
    async getAll(query: ListPaymentsQuery) {
        const where = {
            ...(query.ref_type !== undefined && { ref_type: query.ref_type }),
            ...(query.ref_id !== undefined && { ref_id: query.ref_id }),
            ...(query.direction !== undefined && { direction: query.direction }),
            ...(query.instrument_id !== undefined && {
                OR: [
                    { from_instrument_id: query.instrument_id },
                    { to_instrument_id: query.instrument_id },
                ],
            }),
        };
        const [payments, total] = await Promise.all([
            prisma.payment.findMany({
                where,
                orderBy: { payment_date: "desc" },
                ...toSkipTake(query),
            }),
            prisma.payment.count({ where }),
        ]);
        return { payments, meta: buildMeta(total, query) };
    },

    async getById(id: string) {
        const payment = await prisma.payment.findUnique({ where: { id } });
        if (!payment) throw AppError.notFound("Payment");
        return payment;
    },

    /** Refuses to overpay a record, inside a transaction so two concurrent
     * payments can't both pass the check. This is what keeps every row's
     * outstanding balance >= 0, which in turn is what lets the list summaries
     * compute total due as two scalar sums instead of per-row clamped math. */
    async create(data: CreatePaymentInput) {
        try {
            return await prisma.$transaction(async (tx) => {
                const outstanding = await outstandingWithin(tx, data.ref_type, data.ref_id);
                if (new Prisma.Decimal(data.amount).greaterThan(outstanding)) {
                    throw AppError.badRequest(
                        `Payment exceeds the outstanding balance of ${outstanding.toString()}`,
                        { fields: { amount: `Outstanding balance is ${outstanding.toString()}` } },
                    );
                }

                return tx.payment.create({
                    data: {
                        amount: data.amount,
                        payment_date: data.payment_date,
                        direction: data.direction,
                        ref_type: data.ref_type,
                        ref_id: data.ref_id,
                        from_instrument_id: data.from_instrument_id,
                        ...(data.to_instrument_id !== undefined && {
                            to_instrument_id: data.to_instrument_id,
                        }),
                        ...(data.transaction_ref !== undefined && {
                            transaction_ref: data.transaction_ref,
                        }),
                        ...(data.handled_by_id !== undefined && {
                            handled_by_id: data.handled_by_id,
                        }),
                        ...(data.note !== undefined && { note: data.note }),
                    },
                });
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    /** Live outstanding balance for one polymorphic ref -- the owed figure
     * minus every Payment recorded against it. */
    async outstandingForRef(ref_type: RefType, ref_id: string) {
        return outstandingWithin(prisma, ref_type, ref_id);
    },

    /** Sum of Payment.amount for a given (ref_type, ref_id) -- the read-time
     * substitute for mutating the referenced record's due_amount. */
    async getTotalPaidForRef(ref_type: CreatePaymentInput["ref_type"], ref_id: string) {
        const result = await prisma.payment.aggregate({
            where: { ref_type, ref_id },
            _sum: { amount: true },
        });
        return { ref_type, ref_id, total_paid: result._sum.amount ?? new Prisma.Decimal(0) };
    },
};
