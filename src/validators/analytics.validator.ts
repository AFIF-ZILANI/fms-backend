import { z } from "zod";

export const trendsQuerySchema = z.object({
    days: z.coerce.number().int().positive().max(365).default(30),
});

export type TrendsQuery = z.infer<typeof trendsQuerySchema>;

export const financialDashboardQuerySchema = z.object({
    month: z.coerce.date().optional(),
});

export type FinancialDashboardQuery = z.infer<typeof financialDashboardQuerySchema>;

export const expenseBreakdownQuerySchema = z.object({
    month: z.coerce.date().optional(),
});

export type ExpenseBreakdownQuery = z.infer<typeof expenseBreakdownQuerySchema>;

export const revenueVsExpensesQuerySchema = z.object({
    months: z.coerce.number().int().positive().max(24).default(6),
});

export type RevenueVsExpensesQuery = z.infer<typeof revenueVsExpensesQuerySchema>;

export const batchesPerformanceQuerySchema = z.object({
    status: z.enum(["RUNNING", "CLOSED", "SOLD"]).default("RUNNING"),
});

export type BatchesPerformanceQuery = z.infer<typeof batchesPerformanceQuerySchema>;
