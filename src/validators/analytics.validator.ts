import { z } from "zod";

export const financialDashboardQuerySchema = z.object({
    month: z.coerce.date().optional(),
});

export type FinancialDashboardQuery = z.infer<typeof financialDashboardQuerySchema>;
