import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

export const createPaymentSchema = z.object({
    amount: z.coerce.number().positive("Amount must be positive"),
    payment_date: z.coerce.date(),
    direction: z.enum(["INCOMING", "OUTGOING"]),
    // ref_id is a polymorphic reference (resolved via ref_type), not a real
    // FK -- same pattern as StockLedger.ref_type/ref_id. Not validated
    // against the target table.
    ref_type: z.enum(["SALE", "BIRD_SALE", "PURCHASE", "EXPENSE", "PAYROLL"]),
    ref_id: z.string().uuid(),
    from_instrument_id: z.string().uuid(),
    to_instrument_id: z.string().uuid().optional(),
    transaction_ref: z.string().optional(),
    handled_by_id: z.string().uuid().optional(),
    note: z.string().optional(),
});

export const listPaymentsQuerySchema = paginationQuerySchema.extend({
    ref_type: z.enum(["SALE", "BIRD_SALE", "PURCHASE", "EXPENSE", "PAYROLL"]).optional(),
    ref_id: z.string().uuid().optional(),
    direction: z.enum(["INCOMING", "OUTGOING"]).optional(),
    instrument_id: z.string().uuid().optional(),
});

export const totalPaidQuerySchema = z.object({
    ref_type: z.enum(["SALE", "BIRD_SALE", "PURCHASE", "EXPENSE", "PAYROLL"]),
    ref_id: z.string().uuid(),
});

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
export type ListPaymentsQuery = z.infer<typeof listPaymentsQuerySchema>;
export type TotalPaidQuery = z.infer<typeof totalPaidQuerySchema>;
