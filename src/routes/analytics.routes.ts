import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { FinanceController } from "@controllers/finance.controller";
import {
    financeMonthlyQuerySchema,
    financeOwedQuerySchema,
    financeSummaryQuerySchema,
} from "@validators/finance.validator";
import { AnalyticsController } from "@controllers/analytics.controller";
import {
    batchesPerformanceQuerySchema,
    expenseBreakdownQuerySchema,
    financialDashboardQuerySchema,
    revenueVsExpensesQuerySchema,
    trendsQuerySchema,
    topOutstandingQuerySchema,
} from "@validators/analytics.validator";

export const analyticsRoutes = new Hono();

analyticsRoutes.get("/overview", AnalyticsController.farmOverview);
// The Finance overview: period figures (with comparison), a monthly series, and money owed both ways.
analyticsRoutes.get(
    "/finance/summary",
    zValidatorRfc7807("query", financeSummaryQuerySchema),
    FinanceController.summary,
);
analyticsRoutes.get(
    "/finance/monthly",
    zValidatorRfc7807("query", financeMonthlyQuerySchema),
    FinanceController.monthly,
);
analyticsRoutes.get(
    "/finance/owed",
    zValidatorRfc7807("query", financeOwedQuerySchema),
    FinanceController.owed,
);
analyticsRoutes.get(
    "/financial",
    zValidatorRfc7807("query", financialDashboardQuerySchema),
    AnalyticsController.financialDashboard,
);
analyticsRoutes.get(
    "/batches/performance",
    zValidatorRfc7807("query", batchesPerformanceQuerySchema),
    AnalyticsController.batchesPerformance,
);
analyticsRoutes.get("/batches/:id/performance", AnalyticsController.batchPerformance);
analyticsRoutes.get("/batches/:id/pnl", AnalyticsController.batchPnl);
// Every batch's P&L statement, for comparing them; and how farm-wide costs split between batches.
analyticsRoutes.get("/batches-pnl", AnalyticsController.batchesPnl);
analyticsRoutes.get("/shared-costs", AnalyticsController.sharedCosts);
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
analyticsRoutes.get(
    "/sales/by-product-line",
    zValidatorRfc7807("query", trendsQuerySchema),
    AnalyticsController.salesByProductLine,
);
analyticsRoutes.get(
    "/sales/grade-distribution",
    zValidatorRfc7807("query", trendsQuerySchema),
    AnalyticsController.birdGradeDistribution,
);
analyticsRoutes.get(
    "/sales/top-outstanding-customers",
    zValidatorRfc7807("query", topOutstandingQuerySchema),
    AnalyticsController.topOutstandingCustomers,
);
analyticsRoutes.get(
    "/purchases/by-category",
    zValidatorRfc7807("query", trendsQuerySchema),
    AnalyticsController.purchasesByCategory,
);
analyticsRoutes.get(
    "/purchases/trend",
    zValidatorRfc7807("query", trendsQuerySchema),
    AnalyticsController.purchasesTrend,
);
analyticsRoutes.get(
    "/expenses/breakdown",
    zValidatorRfc7807("query", expenseBreakdownQuerySchema),
    AnalyticsController.expenseBreakdown,
);
analyticsRoutes.get(
    "/revenue-vs-expenses",
    zValidatorRfc7807("query", revenueVsExpensesQuerySchema),
    AnalyticsController.revenueVsExpenses,
);
analyticsRoutes.get("/inventory/stock-value-by-category", AnalyticsController.stockValueByCategory);
analyticsRoutes.get(
    "/inventory/stock-movement-trend",
    zValidatorRfc7807("query", trendsQuerySchema),
    AnalyticsController.stockMovementTrend,
);
analyticsRoutes.get(
    "/inventory/consumption-by-category",
    zValidatorRfc7807("query", trendsQuerySchema),
    AnalyticsController.consumptionByCategory,
);
analyticsRoutes.get(
    "/inventory/consumption-trend",
    zValidatorRfc7807("query", trendsQuerySchema),
    AnalyticsController.consumptionTrend,
);
analyticsRoutes.get(
    "/inventory/wastage-by-category",
    zValidatorRfc7807("query", trendsQuerySchema),
    AnalyticsController.wastageByCategory,
);
