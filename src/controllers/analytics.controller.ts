import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess } from "@lib/response";
import { getValid } from "@lib/valid";
import { AnalyticsService } from "@services/analytics.service";
import type {
    BatchesPerformanceQuery,
    ExpenseBreakdownQuery,
    FinancialDashboardQuery,
    RevenueVsExpensesQuery,
    TrendsQuery,
} from "@validators/analytics.validator";

export const AnalyticsController = {
    async farmOverview(c: Context) {
        return withHandler(c, async () => {
            const overview = await AnalyticsService.farmOverview();
            return sendSuccess(c, overview, "Farm overview computed");
        });
    },

    async batchPerformance(c: Context) {
        return withHandler(c, async () => {
            const performance = await AnalyticsService.batchPerformance(c.req.param("id") ?? "");
            return sendSuccess(c, performance, "Batch performance computed");
        });
    },

    async batchesPerformance(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<BatchesPerformanceQuery>(c, "query");
            const rows = await AnalyticsService.batchesPerformance(query.status);
            return sendSuccess(c, rows, "Batch performance list computed");
        });
    },

    async batchPnl(c: Context) {
        return withHandler(c, async () => {
            const pnl = await AnalyticsService.batchPnl(c.req.param("id") ?? "");
            return sendSuccess(c, pnl, "Batch P&L computed");
        });
    },

    async financialDashboard(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<FinancialDashboardQuery>(c, "query");
            const dashboard = await AnalyticsService.financialDashboard(query);
            return sendSuccess(c, dashboard, "Financial dashboard computed");
        });
    },

    async mortalityTrend(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<TrendsQuery>(c, "query");
            const trend = await AnalyticsService.mortalityTrend(query.days);
            return sendSuccess(c, trend, "Mortality trend computed");
        });
    },

    async feedTrend(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<TrendsQuery>(c, "query");
            const trend = await AnalyticsService.feedTrend(query.days);
            return sendSuccess(c, trend, "Feed trend computed");
        });
    },

    async salesTrend(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<TrendsQuery>(c, "query");
            const trend = await AnalyticsService.salesTrend(query.days);
            return sendSuccess(c, trend, "Sales trend computed");
        });
    },

    async salesByProductLine(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<TrendsQuery>(c, "query");
            const rows = await AnalyticsService.salesByProductLine(query.days);
            return sendSuccess(c, rows, "Sales by product line computed");
        });
    },

    async birdGradeDistribution(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<TrendsQuery>(c, "query");
            const rows = await AnalyticsService.birdGradeDistribution(query.days);
            return sendSuccess(c, rows, "Bird grade distribution computed");
        });
    },

    async purchasesByCategory(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<TrendsQuery>(c, "query");
            const rows = await AnalyticsService.purchasesByCategory(query.days);
            return sendSuccess(c, rows, "Purchases by category computed");
        });
    },

    async purchasesTrend(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<TrendsQuery>(c, "query");
            const trend = await AnalyticsService.purchasesTrend(query.days);
            return sendSuccess(c, trend, "Purchases trend computed");
        });
    },

    async expenseBreakdown(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ExpenseBreakdownQuery>(c, "query");
            const breakdown = await AnalyticsService.expenseBreakdown(query.month);
            return sendSuccess(c, breakdown, "Expense breakdown computed");
        });
    },

    async revenueVsExpenses(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<RevenueVsExpensesQuery>(c, "query");
            const rows = await AnalyticsService.revenueVsExpenses(query.months);
            return sendSuccess(c, rows, "Revenue vs expenses computed");
        });
    },

    async stockValueByCategory(c: Context) {
        return withHandler(c, async () => {
            const rows = await AnalyticsService.stockValueByCategory();
            return sendSuccess(c, rows, "Stock value by category computed");
        });
    },

    async stockMovementTrend(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<TrendsQuery>(c, "query");
            const trend = await AnalyticsService.stockMovementTrend(query.days);
            return sendSuccess(c, trend, "Stock movement trend computed");
        });
    },

    async consumptionByCategory(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<TrendsQuery>(c, "query");
            const rows = await AnalyticsService.consumptionByCategory(query.days);
            return sendSuccess(c, rows, "Consumption by category computed");
        });
    },

    async consumptionTrend(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<TrendsQuery>(c, "query");
            const trend = await AnalyticsService.consumptionTrend(query.days);
            return sendSuccess(c, trend, "Consumption trend computed");
        });
    },

    async wastageByCategory(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<TrendsQuery>(c, "query");
            const rows = await AnalyticsService.wastageByCategory(query.days);
            return sendSuccess(c, rows, "Wastage by category computed");
        });
    },
};
