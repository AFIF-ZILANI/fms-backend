import { z } from "zod";

const day = z.coerce.date();

/** Calendar days, both ends included (YYYY-MM-DD). The comparison period defaults to the same length
 * immediately before. */
export const financeSummaryQuerySchema = z
    .object({ from: day, to: day, compare_from: day.optional(), compare_to: day.optional() })
    .refine((q) => q.from <= q.to, { message: "from must be on or before to", path: ["to"] })
    .refine((q) => (q.compare_from === undefined) === (q.compare_to === undefined), {
        message: "compare_from and compare_to go together",
        path: ["compare_to"],
    });

export const financeMonthlyQuerySchema = z.object({
    months: z.coerce.number().int().min(1).max(24).default(12),
});

export const financeOwedQuerySchema = z.object({
    top: z.coerce.number().int().min(1).max(20).default(5),
});

export type FinanceSummaryQuery = z.infer<typeof financeSummaryQuerySchema>;
export type FinanceMonthlyQuery = z.infer<typeof financeMonthlyQuerySchema>;
export type FinanceOwedQuery = z.infer<typeof financeOwedQuerySchema>;
