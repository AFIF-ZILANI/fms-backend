import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";
import { PAYOUT_METHODS } from "@validators/employee-payout-account.validator";

const method = z.enum(PAYOUT_METHODS);

export const createPayrollPayoutSchema = z.object({
    payroll_record_id: z.string().uuid(),
    // Omit to use the employee's currently active payout account.
    payout_account_id: z.string().uuid().optional(),
    method: method.optional(),
    account_number: z.string().optional(),
    amount: z.coerce.number().positive("Amount must be positive").optional(),
    // What the farm absorbed of the MFS cash-out fee, so the payslip can show
    // the employee receiving the full figure.
    fee_paid_by_farm: z.coerce.number().nonnegative().optional(),
});

/**
 * Marking a payout paid is the one write that needs proof: the transaction
 * reference from the transfer, which is exactly what the generic Payment model
 * could never require (docs/employee-payroll-design.md).
 */
export const markPaidSchema = z.object({
    transaction_ref: z.string().min(1, "A transaction reference is required"),
    paid_by_id: z.string().uuid().optional(),
    paid_at: z.coerce.date().optional(),
});

export const failPayoutSchema = z.object({
    reason: z.string().min(1, "A reason is required"),
});

export const listPayrollPayoutsQuerySchema = paginationQuerySchema.extend({
    status: z.enum(["PENDING", "SENT", "FAILED", "CONFIRMED"]).optional(),
    employee_id: z.string().uuid().optional(),
});

export type CreatePayrollPayoutInput = z.infer<typeof createPayrollPayoutSchema>;
export type MarkPaidInput = z.infer<typeof markPaidSchema>;
export type FailPayoutInput = z.infer<typeof failPayoutSchema>;
export type ListPayrollPayoutsQuery = z.infer<typeof listPayrollPayoutsQuerySchema>;
