import prisma from "@lib/db";
import { Prisma } from "../../prisma/generated/prisma/client";
import { AppError } from "@lib/app-error";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type {
    CreatePaymentInstrumentInput,
    UpdatePaymentInstrumentInput,
    ListPaymentInstrumentsQuery,
} from "@validators/payment-instrument.validator";

export const PaymentInstrumentService = {
    async getAll(query: ListPaymentInstrumentsQuery) {
        const where = {
            ...(query.owner_type !== undefined && { owner_type: query.owner_type }),
            ...(query.owner_id !== undefined && { owner_id: query.owner_id }),
            ...(query.is_active !== undefined && { is_active: query.is_active === "true" }),
        };
        const [instruments, total] = await Promise.all([
            prisma.paymentInstrument.findMany({
                where,
                orderBy: { created_at: "desc" },
                ...toSkipTake(query),
            }),
            prisma.paymentInstrument.count({ where }),
        ]);
        return { instruments, meta: buildMeta(total, query) };
    },

    async getById(id: string) {
        const instrument = await prisma.paymentInstrument.findUnique({ where: { id } });
        if (!instrument) throw AppError.notFound("PaymentInstrument");
        return instrument;
    },

    async create(data: CreatePaymentInstrumentInput) {
        return prisma.paymentInstrument.create({
            data: {
                owner_type: data.owner_type,
                owner_id: data.owner_id,
                type: data.type,
                label: data.label,
                ...(data.bank_name !== undefined && { bank_name: data.bank_name }),
                ...(data.account_no !== undefined && { account_no: data.account_no }),
                ...(data.mobile_no !== undefined && { mobile_no: data.mobile_no }),
                ...(data.mfs_type !== undefined && { mfs_type: data.mfs_type }),
            },
        });
    },

    async update(id: string, data: UpdatePaymentInstrumentInput) {
        const instrument = await prisma.paymentInstrument.findUnique({ where: { id } });
        if (!instrument) throw AppError.notFound("PaymentInstrument");

        const { type, label, bank_name, account_no, mobile_no, mfs_type } = data;
        if (!type && !label && !bank_name && !account_no && !mobile_no && !mfs_type) {
            throw AppError.badRequest("No update fields provided");
        }

        return prisma.paymentInstrument.update({
            where: { id },
            data: {
                ...(type && { type }),
                ...(label && { label }),
                ...(bank_name !== undefined && { bank_name }),
                ...(account_no !== undefined && { account_no }),
                ...(mobile_no !== undefined && { mobile_no }),
                ...(mfs_type !== undefined && { mfs_type }),
            },
        });
    },

    async setActive(id: string, is_active: boolean) {
        const instrument = await prisma.paymentInstrument.findUnique({ where: { id } });
        if (!instrument) throw AppError.notFound("PaymentInstrument");
        return prisma.paymentInstrument.update({ where: { id }, data: { is_active } });
    },

    /** incoming (payments_to) minus outgoing (payments_from), all-time. */
    async getBalance(id: string) {
        const instrument = await prisma.paymentInstrument.findUnique({ where: { id } });
        if (!instrument) throw AppError.notFound("PaymentInstrument");

        const [incoming, outgoing] = await Promise.all([
            prisma.payment.aggregate({ where: { to_instrument_id: id }, _sum: { amount: true } }),
            prisma.payment.aggregate({ where: { from_instrument_id: id }, _sum: { amount: true } }),
        ]);

        const incomingTotal = incoming._sum.amount ?? new Prisma.Decimal(0);
        const outgoingTotal = outgoing._sum.amount ?? new Prisma.Decimal(0);
        return {
            instrument_id: id,
            incoming: incomingTotal,
            outgoing: outgoingTotal,
            balance: incomingTotal.minus(outgoingTotal),
        };
    },
};
