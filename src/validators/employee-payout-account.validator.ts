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
        // Set only when the account isn't in the employee's own name -- and then
        // their signed consent has to be on file.
        holder_relation: z.string().optional(),
        consent_doc_url: z.string().url("Must be a link to the signed consent").optional(),
        // The Owner approving the change. The employee's signed change request is
        // a paper artefact; this records who authorised acting on it.
        verified_by_id: z.string().uuid().optional(),
    })
    .refine((d) => !d.holder_relation || !!d.consent_doc_url, {
        message: "A third-party account needs the holder's signed consent on file",
        path: ["consent_doc_url"],
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

export type CreatePayoutAccountInput = z.infer<typeof createPayoutAccountSchema>;
export type ListPayoutAccountsQuery = z.infer<typeof listPayoutAccountsQuerySchema>;
