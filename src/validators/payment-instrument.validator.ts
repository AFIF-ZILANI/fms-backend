import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

const userRole = z.enum(["ADMIN", "EMPLOYEE", "CUSTOMER", "SUPPLIER", "DOCTOR"]);
const paymentMethod = z.enum(["CASH", "BANK_TRANSFER", "MFS"]);
const mfsType = z.enum(["BKASH", "NAGAD", "ROCKET"]);

export const createPaymentInstrumentSchema = z.object({
    // owner_id is a polymorphic reference (resolved via owner_type), not a
    // real FK -- same untyped-reference pattern StockLedger/Payment use for
    // ref_type/ref_id elsewhere in this schema. Not validated against the
    // target table, consistent with that precedent.
    owner_type: userRole,
    owner_id: z.string().uuid(),
    type: paymentMethod,
    label: z.string().min(1, "Label is required"),
    bank_name: z.string().optional(),
    account_no: z.string().optional(),
    mobile_no: z.string().optional(),
    mfs_type: mfsType.optional(),
});

export const updatePaymentInstrumentSchema = createPaymentInstrumentSchema
    .omit({ owner_type: true, owner_id: true })
    .partial();

export const listPaymentInstrumentsQuerySchema = paginationQuerySchema.extend({
    owner_type: userRole.optional(),
    owner_id: z.string().uuid().optional(),
    is_active: z.enum(["true", "false"]).optional(),
});

export type CreatePaymentInstrumentInput = z.infer<typeof createPaymentInstrumentSchema>;
export type UpdatePaymentInstrumentInput = z.infer<typeof updatePaymentInstrumentSchema>;
export type ListPaymentInstrumentsQuery = z.infer<typeof listPaymentInstrumentsQuerySchema>;
