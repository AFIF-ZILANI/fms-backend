import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

export const createPayrollPayoutSchema = z
    .object({
    // Exactly one: a month's wage, or a festival bonus.
    payroll_record_id: z.string().uuid().optional(),
    bonus_id: z.string().uuid().optional(),
    // Omit to use the employee's currently active payout account.
    payout_account_id: z.string().uuid().optional(),
    // method, account_number, amount and fee_paid_by_farm are deliberately absent: the
    // destination comes from the payout account on file, the amount from the payroll
    // record (or bonus), and the fee is derived from both (lib/payout-fees.ts) -- never quoted by the client.
    })
    .refine((d) => (d.payroll_record_id === undefined) !== (d.bonus_id === undefined), {
        message: "Give exactly one of payroll_record_id or bonus_id",
    });

/**
 * Marking a payout paid is the one write that needs proof: the transaction
 * reference from the transfer, which is exactly what the generic Payment model
 * could never require (docs/employee-payroll-design.md).
 */
export const markPaidSchema = z.object({
    transaction_ref: z.string().min(1, "A transaction reference is required"),
    // Which farm wallet the money left. Required, and not defaulted: a default
    // that is silently wrong puts real outflow on the wrong instrument's
    // balance, and there is no way to tell afterwards.
    from_instrument_id: z.string().uuid("Choose the account this was paid from"),
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
// paid_by_id is stamped by the controller from the session, never accepted from
// the body -- same rule as verified_by_id on a payout account. It also lands on
// the SALARY_TRANSFER_FEE expense as recorded_by_id.
export type MarkPaidInput = z.infer<typeof markPaidSchema> & { paid_by_id: string };
export type FailPayoutInput = z.infer<typeof failPayoutSchema>;
export type ListPayrollPayoutsQuery = z.infer<typeof listPayrollPayoutsQuerySchema>;
