import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { AnalyticsController } from "@controllers/analytics.controller";
import { financialDashboardQuerySchema, trendsQuerySchema } from "@validators/analytics.validator";

export const analyticsRoutes = new Hono();

analyticsRoutes.get("/overview", AnalyticsController.farmOverview);
analyticsRoutes.get(
    "/financial",
    zValidatorRfc7807("query", financialDashboardQuerySchema),
    AnalyticsController.financialDashboard,
);
analyticsRoutes.get("/batches/:id/performance", AnalyticsController.batchPerformance);
analyticsRoutes.get("/batches/:id/pnl", AnalyticsController.batchPnl);
analyticsRoutes.get(
    "/trends/mortality",
    zValidatorRfc7807("query", trendsQuerySchema),
    AnalyticsController.mortalityTrend,
);
analyticsRoutes.get(
    "/trends/feed",
    zValidatorRfc7807("query", trendsQuerySchema),
    AnalyticsController.feedTrend,
);
analyticsRoutes.get(
    "/trends/sales",
    zValidatorRfc7807("query", trendsQuerySchema),
    AnalyticsController.salesTrend,
);
