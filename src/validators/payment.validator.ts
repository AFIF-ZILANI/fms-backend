import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

/** Every ref a Payment row can carry, for reading. */
export const PAYMENT_REF_TYPES = ["SALE", "BIRD_SALE", "PURCHASE", "EXPENSE", "PAYROLL"] as const;

/**
 * What a client may author a payment against. PAYROLL is absent on purpose: a
 * salary payment is emitted by confirming a PayrollPayout, which can require
 * proof of transfer, and Payment cannot. Queryable, not writable.
 * See docs/payroll-ledger-bridge.md.
 */
const creatableRefType = z.enum(["SALE", "BIRD_SALE", "PURCHASE", "EXPENSE"]);
const refType = z.enum(PAYMENT_REF_TYPES);

export const createPaymentSchema = z.object({
    amount: z.coerce.number().positive("Amount must be positive"),
    payment_date: z.coerce.date(),
    // ref_id is a polymorphic reference (resolved via ref_type), not a real
    // FK -- same pattern as StockLedger.ref_type/ref_id. Not validated
    // against the target table.
    ref_type: creatableRefType,
    ref_id: z.string().uuid(),
    from_instrument_id: z.string().uuid(),
    to_instrument_id: z.string().uuid().optional(),
    transaction_ref: z.string().optional(),
    note: z.string().optional(),
});

export const listPaymentsQuerySchema = paginationQuerySchema.extend({
    ref_type: refType.optional(),
    ref_id: z.string().uuid().optional(),
    direction: z.enum(["INCOMING", "OUTGOING"]).optional(),
    instrument_id: z.string().uuid().optional(),
});

export const totalPaidQuerySchema = z.object({
    ref_type: refType,
    ref_id: z.string().uuid(),
});

export const outstandingQuerySchema = z.object({
    ref_type: refType,
});

export type OutstandingQuery = z.infer<typeof outstandingQuerySchema>;
export type CreatePaymentInput = z.infer<typeof createPaymentSchema> & { handled_by_id?: string };
export type PaymentRefType = (typeof PAYMENT_REF_TYPES)[number];
export type ListPaymentsQuery = z.infer<typeof listPaymentsQuerySchema>;
export type TotalPaidQuery = z.infer<typeof totalPaidQuerySchema>;
