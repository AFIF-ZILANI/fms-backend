import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess } from "@lib/response";
import { getValid } from "@lib/valid";
import { AnalyticsService } from "@services/analytics.service";
import type { FinancialDashboardQuery, TrendsQuery } from "@validators/analytics.validator";

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
};
