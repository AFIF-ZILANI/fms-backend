import prisma from "@lib/db";
import { Prisma } from "../../prisma/generated/prisma/client";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type { CreatePaymentInput, ListPaymentsQuery } from "@validators/payment.validator";

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

    async create(data: CreatePaymentInput) {
        try {
            return await prisma.payment.create({
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
                    ...(data.handled_by_id !== undefined && { handled_by_id: data.handled_by_id }),
                    ...(data.note !== undefined && { note: data.note }),
                },
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
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
