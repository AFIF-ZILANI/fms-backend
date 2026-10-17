import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

const paymentMethod = z.enum(["CASH", "BANK_TRANSFER", "MFS"]);
const mfsType = z.enum(["BKASH", "NAGAD", "ROCKET"]);

/** One of the farm's own accounts -- there is no owner: every account here is the farm's. */
export const createPaymentInstrumentSchema = z.object({
    type: paymentMethod,
    label: z.string().min(1, "Label is required"),
    bank_name: z.string().optional(),
    account_no: z.string().optional(),
    mobile_no: z.string().optional(),
    mfs_type: mfsType.optional(),
});

export const updatePaymentInstrumentSchema = createPaymentInstrumentSchema.partial();

export const listPaymentInstrumentsQuerySchema = paginationQuerySchema.extend({
    is_active: z.enum(["true", "false"]).optional(),
});

export type CreatePaymentInstrumentInput = z.infer<typeof createPaymentInstrumentSchema>;
export type UpdatePaymentInstrumentInput = z.infer<typeof updatePaymentInstrumentSchema>;
export type ListPaymentInstrumentsQuery = z.infer<typeof listPaymentInstrumentsQuerySchema>;
