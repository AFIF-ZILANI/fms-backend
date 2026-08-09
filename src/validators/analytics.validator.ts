import { z } from "zod";

export const trendsQuerySchema = z.object({
    days: z.coerce.number().int().positive().max(365).default(30),
});

export type TrendsQuery = z.infer<typeof trendsQuerySchema>;

export const financialDashboardQuerySchema = z.object({
    month: z.coerce.date().optional(),
});

export type FinancialDashboardQuery = z.infer<typeof financialDashboardQuerySchema>;
