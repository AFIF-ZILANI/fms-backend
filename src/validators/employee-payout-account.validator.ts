import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

export const PAYOUT_METHODS = ["BANK", "BKASH", "NAGAD", "ROCKET", "CASH"] as const;
const method = z.enum(PAYOUT_METHODS);

/** 9-digit BEFTN routing number. */
const routing = z.string().regex(/^\d{9}$/, "Routing number must be 9 digits");

export const createPayoutAccountSchema = z
    .object({
        employee_id: z.string().uuid(),
        method,
        account_name: z.string().min(1, "Account name is required"),
        account_number: z.string().min(1, "Account number is required"),
        bank_name: z.string().optional(),
        branch_name: z.string().optional(),
        routing_number: routing.optional(),
        // Set only when the account isn't in the employee's own name.
        holder_relation: z.string().optional(),
    })
    .refine((d) => d.method !== "BANK" || !!d.bank_name, {
        message: "Bank name is required for a bank account",
        path: ["bank_name"],
    });

export const listPayoutAccountsQuerySchema = paginationQuerySchema.extend({
    employee_id: z.string().uuid().optional(),
    // "true" returns only the account currently in force (active_to is null).
    active_only: z.enum(["true", "false"]).optional(),
});

// verified_by_id is stamped by the controller from the session, never accepted
// from the body -- a client that can name who approved a change of wage
// destination can forge the approval for it. Same rule as given_by_id on score
// entries (server/src/lib/current-actor.ts).
export type CreatePayoutAccountInput = z.infer<typeof createPayoutAccountSchema> & {
    verified_by_id: string;
};
export type ListPayoutAccountsQuery = z.infer<typeof listPayoutAccountsQuerySchema>;
