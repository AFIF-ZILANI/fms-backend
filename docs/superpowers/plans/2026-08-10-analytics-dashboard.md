# Analytics Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Analytics page's text-only summary with a chart-driven
operational + financial dashboard, backed by six new read-only aggregate
endpoints.

**Architecture:** Backend adds six pure-aggregation functions to the existing
`AnalyticsService` (no new tables, no writes), exposed via new
`/analytics/...` routes. Frontend adds Recharts-based chart components under
`web/src/pages/analytics/`, each independently fetching its own endpoint via
the existing `useGetData` hook, assembled into the existing
`analytics-page.tsx` layout.

**Tech Stack:** Bun, Hono, Prisma, Zod (backend) · React 19, TanStack Query,
Recharts (new), Tailwind v4, base-ui/react Tabs (frontend).

**Spec:** `server/docs/analytics-dashboard-design.md` — read it before
starting; every task below implements one numbered section of it.

## Global Constraints

- Money/quantity fields are always JSON strings on the wire (Decimal →
  string), per `docs/api.md` §1.9 — every new endpoint response follows
  this; every new frontend type reflects it.
- Colors: only through CSS variable tokens (`docs/design.md` §6) — never a
  hardcoded hex/oklch in a `.tsx` file. New tokens go in `index.css` with
  both light and dark values defined together.
- No dual-axis charts, no donut/pie for part-to-whole — both are
  anti-patterns per the dataviz skill; see spec §4.2 for the two calls this
  affected (sales trend, expense breakdown).
- Categorical color order is fixed, never cycled: blue → orange → aqua →
  yellow (dataviz reference palette slots 1–4); a 5th+ category folds into
  a neutral "Other", never a 5th generated hue.
- Every new backend function gets a test in `analytics.service.test.ts`
  before being wired to a route (TDD — write the test first, watch it fail
  against the not-yet-existing function, then implement).
- Package manager is `bun` in both repos (`bun add`, `bun test`, `bun run
  typecheck`). Server tests: `bun test src/services/analytics.service.test.ts`.
  Web typecheck: `bun run build` runs `tsc -b` first (or `bunx tsc -b
  --noEmit` for a faster check without emitting).

---

## Part A — Backend (`server/`)

### Task 1: Mortality trend endpoint

**Files:**
- Modify: `server/src/validators/analytics.validator.ts`
- Modify: `server/src/services/analytics.service.ts`
- Modify: `server/src/controllers/analytics.controller.ts`
- Modify: `server/src/routes/analytics.routes.ts`
- Modify: `server/src/services/analytics.service.test.ts`

**Interfaces:**
- Produces: `AnalyticsService.mortalityTrend(days: number): Promise<{ date: string; died: number }[]>`
- Produces: `trendsQuerySchema` (zod), `TrendsQuery` type — reused by feed
  and sales trend endpoints in Tasks 2–3 (same `days` shape).
- Route: `GET /api/analytics/trends/mortality?days=30`

- [ ] **Step 1: Add the shared trends query schema and its type**

In `server/src/validators/analytics.validator.ts`, add above the existing
`financialDashboardQuerySchema`:

```ts
export const trendsQuerySchema = z.object({
    days: z.coerce.number().int().positive().max(365).default(30),
});

export type TrendsQuery = z.infer<typeof trendsQuerySchema>;
```

- [ ] **Step 2: Write the failing test**

Append to `server/src/services/analytics.service.test.ts`, inside the
existing `describe("AnalyticsService", ...)` block, after the
`financialDashboard` test:

```ts
    test("mortalityTrend includes today's seeded 20 deaths within the default window", async () => {
        const trend = await AnalyticsService.mortalityTrend(30);
        const today = new Date().toISOString().slice(0, 10);
        const todayRow = trend.find((r) => r.date === today);
        expect(todayRow).toBeDefined();
        expect(todayRow!.died).toBeGreaterThanOrEqual(20);
    });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server && bun test src/services/analytics.service.test.ts -t "mortalityTrend"`
Expected: FAIL — `AnalyticsService.mortalityTrend is not a function`

- [ ] **Step 4: Implement the service function**

In `server/src/services/analytics.service.ts`, add inside the
`AnalyticsService` object, after `farmOverview`:

```ts
    /** Daily death count across every batch, last `days` days. No zero-fill
     * for days with no logs — the chart fills gaps client-side, this stays
     * a straight aggregation. */
    async mortalityTrend(days: number) {
        const since = new Date(Date.now() - days * 86_400_000);
        const grouped = await prisma.mortalityLog.groupBy({
            by: ["date"],
            where: { date: { gte: since } },
            _sum: { count_died: true },
        });
        return grouped
            .map((row) => ({
                date: row.date.toISOString().slice(0, 10),
                died: row._sum.count_died ?? 0,
            }))
            .sort((a, b) => a.date.localeCompare(b.date));
    },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && bun test src/services/analytics.service.test.ts -t "mortalityTrend"`
Expected: PASS

- [ ] **Step 6: Wire the controller**

In `server/src/controllers/analytics.controller.ts`, add the import and
method:

```ts
import type { FinancialDashboardQuery, TrendsQuery } from "@validators/analytics.validator";
```

```ts
    async mortalityTrend(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<TrendsQuery>(c, "query");
            const trend = await AnalyticsService.mortalityTrend(query.days);
            return sendSuccess(c, trend, "Mortality trend computed");
        });
    },
```

- [ ] **Step 7: Wire the route**

In `server/src/routes/analytics.routes.ts`, add the import and route:

```ts
import { financialDashboardQuerySchema, trendsQuerySchema } from "@validators/analytics.validator";
```

```ts
analyticsRoutes.get(
    "/trends/mortality",
    zValidatorRfc7807("query", trendsQuerySchema),
    AnalyticsController.mortalityTrend,
);
```

- [ ] **Step 8: Manual smoke check**

Run: `cd server && bun --hot index.ts` (leave running), then in another
shell: `curl "http://localhost:5085/api/analytics/trends/mortality?days=30"`
Expected: `200` with `{ "success": true, "data": [...] }` including today's row.

- [ ] **Step 9: Commit**

```bash
cd server
git add src/validators/analytics.validator.ts src/services/analytics.service.ts src/controllers/analytics.controller.ts src/routes/analytics.routes.ts src/services/analytics.service.test.ts
git commit -m "feat: add GET /analytics/trends/mortality"
```

---

### Task 2: Feed consumption trend endpoint

**Files:**
- Modify: `server/src/services/analytics.service.ts`
- Modify: `server/src/controllers/analytics.controller.ts`
- Modify: `server/src/routes/analytics.routes.ts`
- Modify: `server/src/services/analytics.service.test.ts`

**Interfaces:**
- Consumes: `trendsQuerySchema`/`TrendsQuery` (Task 1)
- Produces: `AnalyticsService.feedTrend(days: number): Promise<{ date: string; unit: string; quantity: string }[]>`
- Route: `GET /api/analytics/trends/feed?days=30`

- [ ] **Step 1: Seed a FEED consumption row in the shared test fixture**

In `server/src/services/analytics.service.test.ts`, add module-level state
and extend `beforeAll`/`afterAll`. After the existing `let batchId: string;`
add:

```ts
let feedItemId: string;
```

At the end of the existing `beforeAll` (after the `BirdSaleService.create`
call), add:

```ts
        const feedItem = await prisma.item.create({
            data: {
                name: `Analytics Feed ${crypto.randomUUID()}`,
                normalized_key: `analytics-feed-${crypto.randomUUID()}`,
                category: "FEED",
                unit: "BAG",
            },
        });
        feedItemId = feedItem.id;
        await prisma.consumption.create({
            data: {
                batch_id: batchId,
                house_id: houseId,
                item_id: feedItemId,
                quantity: 5,
                date: new Date(),
                recorded_by_id: profileId,
                idempotency_key: crypto.randomUUID(),
            },
        });
```

At the start of the existing `afterAll` (before the other deletes), add:

```ts
        await prisma.consumption.deleteMany({ where: { item_id: feedItemId } });
        await prisma.item.delete({ where: { id: feedItemId } });
```

- [ ] **Step 2: Write the failing test**

```ts
    test("feedTrend groups today's 5-BAG consumption by date and unit", async () => {
        const trend = await AnalyticsService.feedTrend(30);
        const today = new Date().toISOString().slice(0, 10);
        const todayBagRow = trend.find((r) => r.date === today && r.unit === "BAG");
        expect(todayBagRow).toBeDefined();
        expect(parseFloat(todayBagRow!.quantity)).toBeGreaterThanOrEqual(5);
    });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server && bun test src/services/analytics.service.test.ts -t "feedTrend"`
Expected: FAIL — `AnalyticsService.feedTrend is not a function`

- [ ] **Step 4: Implement the service function**

Add to `server/src/services/analytics.service.ts`, after `mortalityTrend`:

```ts
    /** Daily FEED-category consumption, grouped by date AND unit -- quantities
     * in different units (BAG vs KG) must never be summed together, same
     * reasoning as the FCR gap noted on batchPerformance. A raw groupBy can't
     * reach through the item relation for unit, so this groups in memory. */
    async feedTrend(days: number) {
        const since = new Date(Date.now() - days * 86_400_000);
        const rows = await prisma.consumption.findMany({
            where: { date: { gte: since }, item: { category: "FEED" } },
            select: { date: true, quantity: true, item: { select: { unit: true } } },
        });

        const byKey = new Map<string, Prisma.Decimal>();
        for (const row of rows) {
            const dateKey = row.date.toISOString().slice(0, 10);
            const key = `${dateKey}|${row.item.unit}`;
            byKey.set(key, (byKey.get(key) ?? new Prisma.Decimal(0)).plus(row.quantity));
        }

        return Array.from(byKey.entries())
            .map(([key, quantity]) => {
                const [date, unit] = key.split("|") as [string, string];
                return { date, unit, quantity: quantity.toString() };
            })
            .sort((a, b) => a.date.localeCompare(b.date));
    },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && bun test src/services/analytics.service.test.ts -t "feedTrend"`
Expected: PASS

- [ ] **Step 6: Wire the controller**

Add to `server/src/controllers/analytics.controller.ts`:

```ts
    async feedTrend(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<TrendsQuery>(c, "query");
            const trend = await AnalyticsService.feedTrend(query.days);
            return sendSuccess(c, trend, "Feed trend computed");
        });
    },
```

- [ ] **Step 7: Wire the route**

Add to `server/src/routes/analytics.routes.ts`:

```ts
analyticsRoutes.get(
    "/trends/feed",
    zValidatorRfc7807("query", trendsQuerySchema),
    AnalyticsController.feedTrend,
);
```

- [ ] **Step 8: Run the full analytics test file to confirm no regressions**

Run: `cd server && bun test src/services/analytics.service.test.ts`
Expected: all tests PASS (including the pre-existing ones)

- [ ] **Step 9: Commit**

```bash
cd server
git add src/services/analytics.service.ts src/controllers/analytics.controller.ts src/routes/analytics.routes.ts src/services/analytics.service.test.ts
git commit -m "feat: add GET /analytics/trends/feed"
```

---

### Task 3: Bird-sale price trend endpoint

**Files:**
- Modify: `server/src/services/analytics.service.ts`
- Modify: `server/src/controllers/analytics.controller.ts`
- Modify: `server/src/routes/analytics.routes.ts`
- Modify: `server/src/services/analytics.service.test.ts`

**Interfaces:**
- Consumes: `trendsQuerySchema`/`TrendsQuery` (Task 1)
- Produces: `AnalyticsService.salesTrend(days: number): Promise<{ date: string; revenue: string; avg_price_per_kg: string }[]>`
- Route: `GET /api/analytics/trends/sales?days=30`

- [ ] **Step 1: Write the failing test**

The shared fixture already has one bird sale today: 590 net_weight kg ×
200/kg = 118000 total. Add:

```ts
    test("salesTrend reports today's revenue and volume-weighted avg price", async () => {
        const trend = await AnalyticsService.salesTrend(30);
        const today = new Date().toISOString().slice(0, 10);
        const todayRow = trend.find((r) => r.date === today);
        expect(todayRow).toBeDefined();
        expect(parseFloat(todayRow!.revenue)).toBeGreaterThanOrEqual(118000);
        expect(parseFloat(todayRow!.avg_price_per_kg)).toBeCloseTo(200, 0);
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && bun test src/services/analytics.service.test.ts -t "salesTrend"`
Expected: FAIL — `AnalyticsService.salesTrend is not a function`

- [ ] **Step 3: Implement the service function**

Add to `server/src/services/analytics.service.ts`, after `feedTrend`:

```ts
    /** Daily bird-sale revenue and volume-weighted avg price/kg (total
     * revenue / total net weight for the day, not an average of averages --
     * a 10kg sale and a 500kg sale don't count equally). */
    async salesTrend(days: number) {
        const since = new Date(Date.now() - days * 86_400_000);
        const grouped = await prisma.birdSale.groupBy({
            by: ["sale_date"],
            where: { sale_date: { gte: since } },
            _sum: { total_amount: true, net_weight: true },
        });
        return grouped
            .map((row) => {
                const revenue = row._sum.total_amount ?? new Prisma.Decimal(0);
                const weight = row._sum.net_weight ?? new Prisma.Decimal(0);
                const avgPrice = weight.isZero() ? new Prisma.Decimal(0) : revenue.div(weight);
                return {
                    date: row.sale_date.toISOString().slice(0, 10),
                    revenue: revenue.toString(),
                    avg_price_per_kg: avgPrice.toString(),
                };
            })
            .sort((a, b) => a.date.localeCompare(b.date));
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && bun test src/services/analytics.service.test.ts -t "salesTrend"`
Expected: PASS

- [ ] **Step 5: Wire the controller**

Add to `server/src/controllers/analytics.controller.ts`:

```ts
    async salesTrend(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<TrendsQuery>(c, "query");
            const trend = await AnalyticsService.salesTrend(query.days);
            return sendSuccess(c, trend, "Sales trend computed");
        });
    },
```

- [ ] **Step 6: Wire the route**

Add to `server/src/routes/analytics.routes.ts`:

```ts
analyticsRoutes.get(
    "/trends/sales",
    zValidatorRfc7807("query", trendsQuerySchema),
    AnalyticsController.salesTrend,
);
```

- [ ] **Step 7: Commit**

```bash
cd server
git add src/services/analytics.service.ts src/controllers/analytics.controller.ts src/routes/analytics.routes.ts src/services/analytics.service.test.ts
git commit -m "feat: add GET /analytics/trends/sales"
```

---

### Task 4: Expense breakdown by category endpoint

**Files:**
- Modify: `server/src/validators/analytics.validator.ts`
- Modify: `server/src/services/analytics.service.ts`
- Modify: `server/src/controllers/analytics.controller.ts`
- Modify: `server/src/routes/analytics.routes.ts`
- Modify: `server/src/services/analytics.service.test.ts`

**Interfaces:**
- Produces: `expenseBreakdownQuerySchema`, `ExpenseBreakdownQuery` type
- Produces: `AnalyticsService.expenseBreakdown(month?: Date): Promise<{ category: string; total: string }[]>`
- Route: `GET /api/analytics/expenses/breakdown?month=YYYY-MM-DD`

- [ ] **Step 1: Add the query schema**

In `server/src/validators/analytics.validator.ts`, add (same shape as
`financialDashboardQuerySchema`, kept separate since it's a conceptually
different endpoint even though the schema is identical today):

```ts
export const expenseBreakdownQuerySchema = z.object({
    month: z.coerce.date().optional(),
});

export type ExpenseBreakdownQuery = z.infer<typeof expenseBreakdownQuerySchema>;
```

- [ ] **Step 2: Write the failing test**

The shared fixture has one `VET_FEE` expense of 2000 today. Add:

```ts
    test("expenseBreakdown groups the seeded VET_FEE expense by category for the current month", async () => {
        const breakdown = await AnalyticsService.expenseBreakdown();
        const vetFeeRow = breakdown.find((r) => r.category === "VET_FEE");
        expect(vetFeeRow).toBeDefined();
        expect(parseFloat(vetFeeRow!.total)).toBeGreaterThanOrEqual(2000);
    });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server && bun test src/services/analytics.service.test.ts -t "expenseBreakdown"`
Expected: FAIL — `AnalyticsService.expenseBreakdown is not a function`

- [ ] **Step 4: Implement the service function**

Add to `server/src/services/analytics.service.ts`, after `salesTrend`. Reuse
the same month-window resolution as `financialDashboard`:

```ts
    async expenseBreakdown(month?: Date) {
        const resolvedMonth = month ?? new Date();
        const monthStart = new Date(Date.UTC(resolvedMonth.getUTCFullYear(), resolvedMonth.getUTCMonth(), 1));
        const monthEnd = new Date(Date.UTC(resolvedMonth.getUTCFullYear(), resolvedMonth.getUTCMonth() + 1, 1));

        const grouped = await prisma.expense.groupBy({
            by: ["category"],
            where: { date: { gte: monthStart, lt: monthEnd } },
            _sum: { amount: true },
        });

        return grouped
            .map((row) => ({
                category: row.category,
                total: (row._sum.amount ?? new Prisma.Decimal(0)).toString(),
            }))
            .sort((a, b) => parseFloat(b.total) - parseFloat(a.total));
    },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && bun test src/services/analytics.service.test.ts -t "expenseBreakdown"`
Expected: PASS

- [ ] **Step 6: Wire the controller**

In `server/src/controllers/analytics.controller.ts`, update the type import:

```ts
import type { ExpenseBreakdownQuery, FinancialDashboardQuery, TrendsQuery } from "@validators/analytics.validator";
```

Add:

```ts
    async expenseBreakdown(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ExpenseBreakdownQuery>(c, "query");
            const breakdown = await AnalyticsService.expenseBreakdown(query.month);
            return sendSuccess(c, breakdown, "Expense breakdown computed");
        });
    },
```

- [ ] **Step 7: Wire the route**

In `server/src/routes/analytics.routes.ts`, update the import and add the
route:

```ts
import { expenseBreakdownQuerySchema, financialDashboardQuerySchema, trendsQuerySchema } from "@validators/analytics.validator";
```

```ts
analyticsRoutes.get(
    "/expenses/breakdown",
    zValidatorRfc7807("query", expenseBreakdownQuerySchema),
    AnalyticsController.expenseBreakdown,
);
```

- [ ] **Step 8: Commit**

```bash
cd server
git add src/validators/analytics.validator.ts src/services/analytics.service.ts src/controllers/analytics.controller.ts src/routes/analytics.routes.ts src/services/analytics.service.test.ts
git commit -m "feat: add GET /analytics/expenses/breakdown"
```

---

### Task 5: Revenue vs expenses (monthly, N months) endpoint

**Files:**
- Modify: `server/src/validators/analytics.validator.ts`
- Modify: `server/src/services/analytics.service.ts`
- Modify: `server/src/controllers/analytics.controller.ts`
- Modify: `server/src/routes/analytics.routes.ts`
- Modify: `server/src/services/analytics.service.test.ts`

**Interfaces:**
- Produces: `revenueVsExpensesQuerySchema`, `RevenueVsExpensesQuery` type
- Produces: `AnalyticsService.revenueVsExpenses(months: number): Promise<{ month: string; revenue: string; expenses: string }[]>`
- Route: `GET /api/analytics/revenue-vs-expenses?months=6`

- [ ] **Step 1: Add the query schema**

In `server/src/validators/analytics.validator.ts`, add:

```ts
export const revenueVsExpensesQuerySchema = z.object({
    months: z.coerce.number().int().positive().max(24).default(6),
});

export type RevenueVsExpensesQuery = z.infer<typeof revenueVsExpensesQuerySchema>;
```

- [ ] **Step 2: Write the failing test**

```ts
    test("revenueVsExpenses' current month includes the seeded bird-sale revenue and expense", async () => {
        const rows = await AnalyticsService.revenueVsExpenses(6);
        const thisMonth = new Date().toISOString().slice(0, 7);
        const currentRow = rows.find((r) => r.month === thisMonth);
        expect(currentRow).toBeDefined();
        expect(parseFloat(currentRow!.revenue)).toBeGreaterThanOrEqual(118000);
        expect(parseFloat(currentRow!.expenses)).toBeGreaterThanOrEqual(2000);
    });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server && bun test src/services/analytics.service.test.ts -t "revenueVsExpenses"`
Expected: FAIL — `AnalyticsService.revenueVsExpenses is not a function`

- [ ] **Step 4: Implement the service function**

Add to `server/src/services/analytics.service.ts`, after `expenseBreakdown`.
Loops N month-windows, reusing the same per-month aggregate shape as
`financialDashboard` rather than a different SQL date-bucketing approach:

```ts
    async revenueVsExpenses(months: number) {
        const now = new Date();
        const windows = Array.from({ length: months }, (_, i) => {
            const monthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
            const monthStart = monthDate;
            const monthEnd = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 1));
            return { label: monthStart.toISOString().slice(0, 7), monthStart, monthEnd };
        });

        const rows = await Promise.all(
            windows.map(async ({ label, monthStart, monthEnd }) => {
                const [saleRevenue, birdSaleRevenue, expenses] = await Promise.all([
                    prisma.sale.aggregate({
                        where: { sale_date: { gte: monthStart, lt: monthEnd } },
                        _sum: { total: true },
                    }),
                    prisma.birdSale.aggregate({
                        where: { sale_date: { gte: monthStart, lt: monthEnd } },
                        _sum: { total_amount: true },
                    }),
                    prisma.expense.aggregate({
                        where: { date: { gte: monthStart, lt: monthEnd } },
                        _sum: { amount: true },
                    }),
                ]);
                const revenue = (saleRevenue._sum.total ?? new Prisma.Decimal(0)).plus(
                    birdSaleRevenue._sum.total_amount ?? new Prisma.Decimal(0),
                );
                return {
                    month: label,
                    revenue: revenue.toString(),
                    expenses: (expenses._sum.amount ?? new Prisma.Decimal(0)).toString(),
                };
            }),
        );

        return rows.sort((a, b) => a.month.localeCompare(b.month));
    },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && bun test src/services/analytics.service.test.ts -t "revenueVsExpenses"`
Expected: PASS

- [ ] **Step 6: Wire the controller**

Update the type import and add the method to
`server/src/controllers/analytics.controller.ts`:

```ts
import type {
    ExpenseBreakdownQuery,
    FinancialDashboardQuery,
    RevenueVsExpensesQuery,
    TrendsQuery,
} from "@validators/analytics.validator";
```

```ts
    async revenueVsExpenses(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<RevenueVsExpensesQuery>(c, "query");
            const rows = await AnalyticsService.revenueVsExpenses(query.months);
            return sendSuccess(c, rows, "Revenue vs expenses computed");
        });
    },
```

- [ ] **Step 7: Wire the route**

Update the import and add the route in `server/src/routes/analytics.routes.ts`:

```ts
import {
    expenseBreakdownQuerySchema,
    financialDashboardQuerySchema,
    revenueVsExpensesQuerySchema,
    trendsQuerySchema,
} from "@validators/analytics.validator";
```

```ts
analyticsRoutes.get(
    "/revenue-vs-expenses",
    zValidatorRfc7807("query", revenueVsExpensesQuerySchema),
    AnalyticsController.revenueVsExpenses,
);
```

- [ ] **Step 8: Commit**

```bash
cd server
git add src/validators/analytics.validator.ts src/services/analytics.service.ts src/controllers/analytics.controller.ts src/routes/analytics.routes.ts src/services/analytics.service.test.ts
git commit -m "feat: add GET /analytics/revenue-vs-expenses"
```

---

### Task 6: Bulk batch performance endpoint

**Files:**
- Modify: `server/src/validators/analytics.validator.ts`
- Modify: `server/src/services/analytics.service.ts`
- Modify: `server/src/controllers/analytics.controller.ts`
- Modify: `server/src/routes/analytics.routes.ts`
- Modify: `server/src/services/analytics.service.test.ts`

**Interfaces:**
- Produces: `batchesPerformanceQuerySchema`, `BatchesPerformanceQuery` type
- Produces: `AnalyticsService.batchesPerformance(status: "RUNNING" | "CLOSED" | "SOLD"): Promise<BatchPerformance[]>`
  where `BatchPerformance` is the same shape `batchPerformance(batchId)`
  already returns (see `server/src/services/analytics.service.ts` existing
  function — `batch_id`, `live_count`, `initial_chick_count`,
  `cumulative_died`, `cumulative_mortality_rate`, `age_days`,
  `expected_selling_date`, `actual_end_date`, `latest_average_weight_grams`,
  `latest_weight_date`).
- Route: `GET /api/analytics/batches/performance?status=RUNNING`
- The existing single-batch `GET /analytics/batches/:id/performance` is
  untouched — batch detail pages keep using it.

- [ ] **Step 1: Add the query schema**

In `server/src/validators/analytics.validator.ts`, add:

```ts
export const batchesPerformanceQuerySchema = z.object({
    status: z.enum(["RUNNING", "CLOSED", "SOLD"]).default("RUNNING"),
});

export type BatchesPerformanceQuery = z.infer<typeof batchesPerformanceQuerySchema>;
```

- [ ] **Step 2: Write the failing test**

The shared fixture's `batchId` is `RUNNING` with 20 cumulative deaths and a
500g latest weight (same numbers the existing `batchPerformance` test
already asserts). Add:

```ts
    test("batchesPerformance('RUNNING') includes this batch with the same numbers as the single-batch endpoint", async () => {
        const rows = await AnalyticsService.batchesPerformance("RUNNING");
        const row = rows.find((r) => r.batch_id === batchId);
        expect(row).toBeDefined();
        expect(row!.live_count).toBe(680);
        expect(row!.cumulative_died).toBe(20);
        expect(row!.cumulative_mortality_rate).toBeCloseTo(0.02, 4);
        expect(row!.latest_average_weight_grams?.toNumber()).toBe(500);
    });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server && bun test src/services/analytics.service.test.ts -t "batchesPerformance"`
Expected: FAIL — `AnalyticsService.batchesPerformance is not a function`

- [ ] **Step 4: Implement the service function**

Add to `server/src/services/analytics.service.ts`, after `batchPerformance`
(keep it next to the single-batch version — same computation, bulk shape).
Three queries total regardless of batch count: batches+balances, a grouped
mortality sum, and one ordered weight-records fetch reduced to "first per
batch" in memory (avoids both N+1 and a raw-SQL window function):

```ts
    /** Bulk version of batchPerformance -- one query set for every matching
     * batch instead of one request per batch. Powers both the batch
     * comparison chart and the Analytics page's performance table. */
    async batchesPerformance(status: "RUNNING" | "CLOSED" | "SOLD") {
        const batches = await prisma.batches.findMany({
            where: { status },
            include: { houseBalances: true },
        });
        const batchIds = batches.map((b) => b.id);

        const [mortalityByBatch, weightRecords] = await Promise.all([
            prisma.mortalityLog.groupBy({
                by: ["batch_id"],
                where: { batch_id: { in: batchIds } },
                _sum: { count_died: true },
            }),
            prisma.weightRecords.findMany({
                where: { batch_id: { in: batchIds } },
                orderBy: { date: "desc" },
            }),
        ]);

        const diedByBatch = new Map(mortalityByBatch.map((m) => [m.batch_id, m._sum.count_died ?? 0]));
        const latestWeightByBatch = new Map<string, (typeof weightRecords)[number]>();
        for (const record of weightRecords) {
            if (record.batch_id && !latestWeightByBatch.has(record.batch_id)) {
                latestWeightByBatch.set(record.batch_id, record);
            }
        }

        return batches.map((batch) => {
            const liveCount = batch.houseBalances.reduce((sum, b) => sum + b.quantity, 0);
            const died = diedByBatch.get(batch.id) ?? 0;
            const latestWeight = latestWeightByBatch.get(batch.id);
            return {
                batch_id: batch.id,
                live_count: liveCount,
                initial_chick_count: batch.initial_chick_count,
                cumulative_died: died,
                cumulative_mortality_rate: batch.initial_chick_count > 0 ? died / batch.initial_chick_count : 0,
                age_days: Math.floor((Date.now() - batch.starting_date.getTime()) / 86_400_000),
                expected_selling_date: batch.expected_selling_date,
                actual_end_date: batch.actual_end_date,
                latest_average_weight_grams: latestWeight?.average_wt_grams ?? null,
                latest_weight_date: latestWeight?.date ?? null,
            };
        });
    },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && bun test src/services/analytics.service.test.ts -t "batchesPerformance"`
Expected: PASS

- [ ] **Step 6: Wire the controller**

Update the type import and add the method in
`server/src/controllers/analytics.controller.ts`:

```ts
import type {
    BatchesPerformanceQuery,
    ExpenseBreakdownQuery,
    FinancialDashboardQuery,
    RevenueVsExpensesQuery,
    TrendsQuery,
} from "@validators/analytics.validator";
```

```ts
    async batchesPerformance(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<BatchesPerformanceQuery>(c, "query");
            const rows = await AnalyticsService.batchesPerformance(query.status);
            return sendSuccess(c, rows, "Batch performance list computed");
        });
    },
```

- [ ] **Step 7: Wire the route**

Update the import and add the route **before** the existing
`/batches/:id/performance` route (so `/batches/performance` doesn't get
swallowed by the `:id` param match) in `server/src/routes/analytics.routes.ts`:

```ts
import {
    batchesPerformanceQuerySchema,
    expenseBreakdownQuerySchema,
    financialDashboardQuerySchema,
    revenueVsExpensesQuerySchema,
    trendsQuerySchema,
} from "@validators/analytics.validator";
```

```ts
analyticsRoutes.get(
    "/batches/performance",
    zValidatorRfc7807("query", batchesPerformanceQuerySchema),
    AnalyticsController.batchesPerformance,
);
analyticsRoutes.get("/batches/:id/performance", AnalyticsController.batchPerformance);
```

- [ ] **Step 8: Run the full test file to confirm route ordering and no regressions**

Run: `cd server && bun test src/services/analytics.service.test.ts`
Expected: all tests PASS

- [ ] **Step 9: Commit**

```bash
cd server
git add src/validators/analytics.validator.ts src/services/analytics.service.ts src/controllers/analytics.controller.ts src/routes/analytics.routes.ts src/services/analytics.service.test.ts
git commit -m "feat: add GET /analytics/batches/performance (bulk)"
```

---

### Task 7: Document the six new routes in api.md

**Files:**
- Modify: `server/docs/api.md`

**Interfaces:**
- Consumes: nothing new — documents Tasks 1–6's routes as shipped.

- [ ] **Step 1: Find the existing Analytics section**

Run: `cd server && grep -n "^## .*Analytics\|analytics/overview\|analytics/financial" docs/api.md`

This locates the existing Analytics route table (the same one documenting
`/analytics/overview`, `/analytics/financial`,
`/analytics/batches/:id/performance`, `/analytics/batches/:id/pnl`).

- [ ] **Step 2: Add a new subsection immediately after the existing Analytics route table**

Insert (matching the existing table format used elsewhere in this file —
Method / Path / Status / Query columns):

```markdown
### Analytics trends & aggregates

Read-only, same reporting rules as the rest of Analytics (§ above) — no
state of its own.

| Method | Path | Status | Query |
|---|---|---|---|
| GET | `/api/analytics/trends/mortality` | 200 | `days?` (int, 1-365, default 30) |
| GET | `/api/analytics/trends/feed` | 200 | `days?` (int, 1-365, default 30) |
| GET | `/api/analytics/trends/sales` | 200 | `days?` (int, 1-365, default 30) |
| GET | `/api/analytics/expenses/breakdown` | 200 | `month?` (date, defaults to current month) |
| GET | `/api/analytics/revenue-vs-expenses` | 200 | `months?` (int, 1-24, default 6) |
| GET | `/api/analytics/batches/performance` | 200 | `status?` (`RUNNING`\|`CLOSED`\|`SOLD`, default `RUNNING`) |

**`/trends/mortality`** — `{ date: string (YYYY-MM-DD), died: number }[]`,
one row per day with at least one logged death (no zero-fill).

**`/trends/feed`** — `{ date: string, unit: Units, quantity: string }[]`,
grouped by date **and** unit (FEED-category consumption only) — quantities
in different units are never summed together.

**`/trends/sales`** — `{ date: string, revenue: string, avg_price_per_kg: string }[]`,
`avg_price_per_kg` is volume-weighted (`total revenue / total net weight`
for the day), not an average of per-sale averages.

**`/expenses/breakdown`** — `{ category: ExpenseCategory, total: string }[]`,
sorted descending by total.

**`/revenue-vs-expenses`** — `{ month: string (YYYY-MM), revenue: string, expenses: string }[]`,
ascending by month. `revenue` = `Sale.total` + `BirdSale.total_amount` for
that month, same computation as `/analytics/financial`.

**`/batches/performance`** — bulk version of
`/analytics/batches/:id/performance`; same per-batch shape, array instead
of one object. Added so the Analytics page's batch table and comparison
chart can fetch every batch's numbers in one request instead of one per
batch.
```

- [ ] **Step 3: Verify formatting renders correctly**

Run: `cd server && bunx prettier --check docs/api.md 2>&1 || true` (prettier
doesn't enforce markdown table alignment, this just catches stray tabs/
trailing whitespace — not a blocking check, just a sanity pass)

- [ ] **Step 4: Commit**

```bash
cd server
git add docs/api.md
git commit -m "docs: document the six new analytics aggregate routes"
```

---

## Part B — Frontend (`web/`)

### Task 8: Recharts, chart tokens, and shared chart infrastructure

**Files:**
- Modify: `web/package.json` (via `bun add`)
- Modify: `web/src/index.css`
- Create: `web/src/pages/analytics/chart-theme.ts`
- Create: `web/src/pages/analytics/day-range-toggle.tsx`

**Interfaces:**
- Produces: CSS tokens `--chart-cat-1..4`, `--chart-cat-other` (light+dark)
- Produces: fixed `.dark` values for `--chart-1..5` (see Step 2 — the
  existing dark block duplicates the light values verbatim, which makes a
  single-series line invisible against a dark background; every chart task
  after this one depends on this being fixed)
- Produces: `CHART_HEIGHT`, `chartGridProps`, `chartAxisProps`,
  `chartTooltipContentStyle` from `chart-theme.ts` — consumed by every
  chart component in Tasks 11–18
- Produces: `<DayRangeToggle value={days} onValueChange={setDays} />` from
  `day-range-toggle.tsx` — consumed by every trend chart with a 7/30/90
  toggle (Tasks 11, 12, 15)

- [ ] **Step 1: Install Recharts**

Run: `cd web && bun add recharts`

- [ ] **Step 2: Fix the dark-mode chart token values**

Read `web/src/index.css` lines 70-130 first to get exact current context
(the `.dark` block currently repeats the light block's `--chart-1..5`
values verbatim — oklch 0.87→0.269 — which is illegible against the dark
background's oklch 0.145). In the `.dark` block, replace the five
`--chart-*` lines with an inverted ramp so "chart-5" stays the strongest
line in both themes, just inverted in lightness direction:

```css
    --chart-1: oklch(0.32 0 0);
    --chart-2: oklch(0.44 0 0);
    --chart-3: oklch(0.58 0 0);
    --chart-4: oklch(0.72 0 0);
    --chart-5: oklch(0.87 0 0);
```

(Leave the `:root`/light block's five `--chart-*` lines exactly as they are.)

- [ ] **Step 3: Add categorical chart tokens**

In the same `:root` block (light), immediately after the existing
`--chart-5` line, add:

```css
    --chart-cat-1: #2a78d6;
    --chart-cat-2: #eb6834;
    --chart-cat-3: #1baf7a;
    --chart-cat-4: #eda100;
```

In the `.dark` block, after the `--chart-5` line from Step 2, add:

```css
    --chart-cat-1: #3987e5;
    --chart-cat-2: #d95926;
    --chart-cat-3: #199e70;
    --chart-cat-4: #c98500;
```

These are the dataviz skill's reference categorical palette slots 1–4
(blue/orange/aqua/yellow), already validated for adjacent-pair colorblind
safety in both modes — see `server/docs/analytics-dashboard-design.md` §4.2.
There's no separate "Other" token: the expense breakdown chart (Task 17)
uses the existing `--muted-foreground` token for its "Other" bar, since
that's not a real category identity, just a fold-in.

- [ ] **Step 4: Register the new tokens with Tailwind's `@theme inline` block**

In `web/src/index.css`, find the `@theme inline` block (near the top, has
`--color-chart-5: var(--chart-5);` etc.) and add four lines immediately
after the existing `--color-chart-1: var(--chart-1);` line:

```css
    --color-chart-cat-1: var(--chart-cat-1);
    --color-chart-cat-2: var(--chart-cat-2);
    --color-chart-cat-3: var(--chart-cat-3);
    --color-chart-cat-4: var(--chart-cat-4);
```

- [ ] **Step 5: Create the shared chart theme constants**

Create `web/src/pages/analytics/chart-theme.ts`:

```ts
/** Shared visual constants for every Analytics chart — one place to keep
 * grid/axis treatment recessive and marks thin, per docs/design.md §5
 * ("minimal gridlines, no 3D or gradient fills, one accent color per chart
 * max") and the dataviz skill's mark specs. */

export const CHART_HEIGHT = 240;

export const chartGridProps = {
  strokeDasharray: "3 3",
  stroke: "var(--color-border)",
  vertical: false,
};

export const chartAxisProps = {
  stroke: "var(--color-muted-foreground)",
  fontSize: 12,
  tickLine: false,
  axisLine: false,
};

export const chartTooltipContentStyle: React.CSSProperties = {
  background: "var(--color-card)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-lg)",
  fontSize: 12,
};

export const SINGLE_SERIES_STROKE = "var(--color-chart-5)";
export const CATEGORICAL_COLORS = [
  "var(--color-chart-cat-1)",
  "var(--color-chart-cat-2)",
  "var(--color-chart-cat-3)",
  "var(--color-chart-cat-4)",
];
export const OTHER_COLOR = "var(--color-muted-foreground)";
```

- [ ] **Step 6: Create the shared day-range toggle**

Create `web/src/pages/analytics/day-range-toggle.tsx`:

```tsx
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const OPTIONS = [7, 30, 90] as const;

type DayRangeToggleProps = {
  value: number;
  onValueChange: (value: number) => void;
};

/** Segmented 7/30/90-day control shared by every trend chart on the
 * Analytics page. Each chart owns its own instance and its own fetch --
 * there's no shared/global range state (docs/analytics-dashboard-design.md §4.2). */
export function DayRangeToggle({ value, onValueChange }: DayRangeToggleProps) {
  return (
    <Tabs value={String(value)} onValueChange={(v) => onValueChange(Number(v))}>
      <TabsList>
        {OPTIONS.map((days) => (
          <TabsTrigger key={days} value={String(days)}>
            {days}d
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
```

- [ ] **Step 7: Verify the build picks up the new dependency and tokens**

Run: `cd web && bun run build`
Expected: build succeeds (this file has no consumers yet, so this just
confirms recharts installed cleanly and `index.css`/`chart-theme.ts` have
no syntax errors)

- [ ] **Step 8: Commit**

```bash
cd web
git add package.json bun.lock src/index.css src/pages/analytics/chart-theme.ts src/pages/analytics/day-range-toggle.tsx
git commit -m "feat: add recharts, categorical chart tokens, fix dark chart ramp

The .dark block's --chart-1..5 values duplicated light-mode values verbatim, making single-series chart lines invisible against the dark background. Inverted the ramp so chart-5 stays the strongest line in both themes."
```

---

### Task 9: Analytics response types

**Files:**
- Modify: `web/src/pages/analytics/types.ts`

**Interfaces:**
- Produces: `MortalityTrendPoint`, `FeedTrendPoint`, `SalesTrendPoint`,
  `ExpenseBreakdownRow`, `RevenueVsExpensesPoint`, `BatchPerformance[]`
  (already exists as a single type — this task doesn't change it, the bulk
  endpoint returns an array of the existing shape).

- [ ] **Step 1: Add the new types**

Append to `web/src/pages/analytics/types.ts`:

```ts
export type MortalityTrendPoint = {
  date: string;
  died: number;
};

export type FeedTrendPoint = {
  date: string;
  unit: string;
  quantity: string;
};

export type SalesTrendPoint = {
  date: string;
  revenue: string;
  avg_price_per_kg: string;
};

export type ExpenseBreakdownRow = {
  category: string;
  total: string;
};

export type RevenueVsExpensesPoint = {
  month: string;
  revenue: string;
  expenses: string;
};
```

- [ ] **Step 2: Typecheck**

Run: `cd web && bunx tsc -b --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
cd web
git add src/pages/analytics/types.ts
git commit -m "feat: add response types for the new analytics endpoints"
```

---

### Task 10: Bulk batch performance — refactor the table off N+1

**Files:**
- Modify: `web/src/pages/analytics/batch-performance-row.tsx`
- Modify: `web/src/pages/analytics/analytics-page.tsx`

**Interfaces:**
- Consumes: `GET /analytics/batches/performance?status=RUNNING` (Task 6),
  `BatchPerformance` type (existing, `web/src/pages/analytics/types.ts`)
- Produces: `<BatchPerformanceRow batch={batch} performance={performance} />`
  (was `<BatchPerformanceRow batch={batch} />` fetching internally) —
  Task 12 (batch comparison chart) also consumes the same bulk fetch this
  task introduces on the page.

- [ ] **Step 1: Make `BatchPerformanceRow` presentational**

Replace the full contents of
`web/src/pages/analytics/batch-performance-row.tsx`:

```tsx
import { useNavigate } from "react-router";
import { TableCell, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/shared/status-badge";
import type { Batch } from "@/pages/batches/types";
import type { BatchPerformance } from "@/pages/analytics/types";

export function BatchPerformanceRow({ batch, performance }: { batch: Batch; performance: BatchPerformance }) {
  const navigate = useNavigate();
  const mortalityPercent = (performance.cumulative_mortality_rate * 100).toFixed(1);
  const mortalityTone =
    performance.cumulative_mortality_rate > 0.05
      ? "critical"
      : performance.cumulative_mortality_rate > 0.02
        ? "warning"
        : "success";

  return (
    <TableRow className="cursor-pointer" onClick={() => navigate(`/batches/${batch.id}`)}>
      <TableCell className="font-medium">{batch.batch_code}</TableCell>
      <TableCell className="text-right tabular-nums">{performance.age_days}d</TableCell>
      <TableCell className="text-right tabular-nums">
        {performance.live_count} / {performance.initial_chick_count}
      </TableCell>
      <TableCell className="text-right">
        <StatusBadge tone={mortalityTone} label={`${mortalityPercent}%`} />
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {performance.latest_average_weight_grams ? `${performance.latest_average_weight_grams} g` : "—"}
      </TableCell>
      <TableCell>
        {performance.expected_selling_date ? new Date(performance.expected_selling_date).toLocaleDateString() : "—"}
      </TableCell>
    </TableRow>
  );
}
```

(Confirm the exact `StatusBadge` tone prop type first: run
`grep -n "tone" web/src/components/shared/status-badge.tsx` — if it's a
union type rather than `string`, the `mortalityTone` ternary above already
produces valid members `"critical" | "warning" | "success"`, matching the
original file's behavior unchanged.)

- [ ] **Step 2: Fetch bulk performance data on the page and pass it down**

In `web/src/pages/analytics/analytics-page.tsx`, add the import:

```ts
import type { BatchPerformance } from "@/pages/analytics/types";
```

Add a new query alongside the existing `overview`/`batches` queries:

```ts
  const { data: performances, isLoading: performancesLoading } = useGetData<BatchPerformance[]>(
    "/analytics/batches/performance?status=RUNNING",
    ["analytics", "batches-performance", "RUNNING"],
  );
```

Replace the row-mapping in the batch performance `<TableBody>`:

```tsx
                <TableBody>
                  {(batches?.results ?? []).map((b) => {
                    const performance = performances?.find((p) => p.batch_id === b.id);
                    if (!performance) return null;
                    return <BatchPerformanceRow key={b.id} batch={b} performance={performance} />;
                  })}
                </TableBody>
```

Update the loading guard just above the table (currently
`!batchesLoading && (batches?.results.length ?? 0) === 0`) to also account
for the new query:

```tsx
          {!batchesLoading && !performancesLoading && (batches?.results.length ?? 0) === 0 ? (
```

- [ ] **Step 3: Manual verification**

Run: `cd web && bun run dev` (leave running), open the Analytics page in a
browser with at least one RUNNING batch seeded. Confirm the table renders
identically to before (same columns, same values) — open the Network tab
and confirm there's exactly one request to
`/analytics/batches/performance`, not one per batch.

- [ ] **Step 4: Commit**

```bash
cd web
git add src/pages/analytics/batch-performance-row.tsx src/pages/analytics/analytics-page.tsx
git commit -m "refactor: batch performance table off N+1 per-row fetch

Now fed by GET /analytics/batches/performance (one request for every batch) instead of one request per row."
```

---

### Task 11: Mortality trend chart

**Files:**
- Create: `web/src/pages/analytics/mortality-trend-chart.tsx`
- Modify: `web/src/pages/analytics/analytics-page.tsx`

**Interfaces:**
- Consumes: `GET /analytics/trends/mortality?days=N` (Task 1),
  `MortalityTrendPoint` (Task 9), `DayRangeToggle` (Task 8), `chart-theme.ts`
  exports (Task 8), `EmptyState` (existing shared component)
- Produces: `<MortalityTrendChart />` — self-contained, no props, mounted
  directly on the page.

- [ ] **Step 1: Create the component**

Create `web/src/pages/analytics/mortality-trend-chart.tsx`:

```tsx
import { useState } from "react";
import { TrendingDown } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { useGetData } from "@/lib/api";
import { DayRangeToggle } from "@/pages/analytics/day-range-toggle";
import { CHART_HEIGHT, chartAxisProps, chartGridProps, chartTooltipContentStyle, SINGLE_SERIES_STROKE } from "@/pages/analytics/chart-theme";
import type { MortalityTrendPoint } from "@/pages/analytics/types";

export function MortalityTrendChart() {
  const [days, setDays] = useState(30);
  const { data, isLoading } = useGetData<MortalityTrendPoint[]>(`/analytics/trends/mortality?days=${days}`, [
    "analytics",
    "trends",
    "mortality",
    days,
  ]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Mortality trend</CardTitle>
        <DayRangeToggle value={days} onValueChange={setDays} />
      </CardHeader>
      <CardContent>
        {isLoading && <Skeleton style={{ height: CHART_HEIGHT }} className="w-full" />}
        {!isLoading && (data?.length ?? 0) === 0 && (
          <EmptyState icon={TrendingDown} title="No deaths logged" description={`Nothing recorded in the last ${days} days.`} />
        )}
        {!isLoading && (data?.length ?? 0) > 0 && (
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <LineChart data={data}>
              <CartesianGrid {...chartGridProps} />
              <XAxis dataKey="date" {...chartAxisProps} />
              <YAxis {...chartAxisProps} allowDecimals={false} />
              <Tooltip contentStyle={chartTooltipContentStyle} />
              <Line
                type="monotone"
                dataKey="died"
                name="Died"
                stroke={SINGLE_SERIES_STROKE}
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Mount it on the Analytics page**

In `web/src/pages/analytics/analytics-page.tsx`, add the import:

```ts
import { MortalityTrendChart } from "@/pages/analytics/mortality-trend-chart";
```

Add a new grid row after the existing "Unresolved alerts by level" `Card`
block and before the "Batch performance" `Card`:

```tsx
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <MortalityTrendChart />
      </div>
```

(Task 12 adds the feed trend chart as the second item in this same grid row.)

- [ ] **Step 3: Manual verification**

Run: `cd web && bun run dev`, open Analytics. Confirm the chart renders
with the seeded mortality log, the 7/30/90 toggle refetches and updates the
line, and switching to dark mode keeps the line clearly visible (this is
what Task 8 Step 2 fixed).

- [ ] **Step 4: Commit**

```bash
cd web
git add src/pages/analytics/mortality-trend-chart.tsx src/pages/analytics/analytics-page.tsx
git commit -m "feat: add mortality trend chart to Analytics page"
```

---

### Task 12: Feed consumption trend chart

**Files:**
- Create: `web/src/pages/analytics/feed-trend-chart.tsx`
- Modify: `web/src/pages/analytics/analytics-page.tsx`

**Interfaces:**
- Consumes: `GET /analytics/trends/feed?days=N` (Task 2), `FeedTrendPoint`
  (Task 9), `DayRangeToggle`/`chart-theme.ts` (Task 8)
- Produces: `<FeedTrendChart />`

- [ ] **Step 1: Create the component**

The endpoint groups by `(date, unit)` — pivot into one bar series per unit
so mixed units never stack together. Create
`web/src/pages/analytics/feed-trend-chart.tsx`:

```tsx
import { useMemo, useState } from "react";
import { Wheat } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { useGetData } from "@/lib/api";
import { DayRangeToggle } from "@/pages/analytics/day-range-toggle";
import {
  CATEGORICAL_COLORS,
  CHART_HEIGHT,
  chartAxisProps,
  chartGridProps,
  chartTooltipContentStyle,
  SINGLE_SERIES_STROKE,
} from "@/pages/analytics/chart-theme";
import type { FeedTrendPoint } from "@/pages/analytics/types";

/** Pivots [{date, unit, quantity}] into [{date, [unit]: quantity}] so each
 * unit renders as its own bar series -- quantities in different units are
 * never summed or stacked into one bar. */
function pivotByUnit(points: FeedTrendPoint[]) {
  const units = Array.from(new Set(points.map((p) => p.unit)));
  const byDate = new Map<string, Record<string, number | string>>();
  for (const point of points) {
    const row = byDate.get(point.date) ?? { date: point.date };
    row[point.unit] = parseFloat(point.quantity);
    byDate.set(point.date, row);
  }
  return { units, rows: Array.from(byDate.values()).sort((a, b) => String(a.date).localeCompare(String(b.date))) };
}

export function FeedTrendChart() {
  const [days, setDays] = useState(30);
  const { data, isLoading } = useGetData<FeedTrendPoint[]>(`/analytics/trends/feed?days=${days}`, [
    "analytics",
    "trends",
    "feed",
    days,
  ]);

  const { units, rows } = useMemo(() => pivotByUnit(data ?? []), [data]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Feed consumption trend</CardTitle>
        <DayRangeToggle value={days} onValueChange={setDays} />
      </CardHeader>
      <CardContent>
        {isLoading && <Skeleton style={{ height: CHART_HEIGHT }} className="w-full" />}
        {!isLoading && rows.length === 0 && (
          <EmptyState icon={Wheat} title="No feed drawn" description={`Nothing recorded in the last ${days} days.`} />
        )}
        {!isLoading && rows.length > 0 && (
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <BarChart data={rows}>
              <CartesianGrid {...chartGridProps} />
              <XAxis dataKey="date" {...chartAxisProps} />
              <YAxis {...chartAxisProps} />
              <Tooltip contentStyle={chartTooltipContentStyle} />
              {units.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
              {units.map((unit, i) => (
                <Bar
                  key={unit}
                  dataKey={unit}
                  name={unit}
                  fill={units.length === 1 ? SINGLE_SERIES_STROKE : CATEGORICAL_COLORS[i % CATEGORICAL_COLORS.length]}
                  radius={[4, 4, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Mount it next to the mortality chart**

In `web/src/pages/analytics/analytics-page.tsx`, add the import:

```ts
import { FeedTrendChart } from "@/pages/analytics/feed-trend-chart";
```

Update the grid row added in Task 11:

```tsx
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <MortalityTrendChart />
        <FeedTrendChart />
      </div>
```

- [ ] **Step 3: Manual verification**

Run the dev server, confirm the seeded 5-BAG consumption row renders as a
single bar with a "BAG" y-axis, no legend (only one unit present).

- [ ] **Step 4: Commit**

```bash
cd web
git add src/pages/analytics/feed-trend-chart.tsx src/pages/analytics/analytics-page.tsx
git commit -m "feat: add feed consumption trend chart to Analytics page"
```

---

### Task 13: Batch comparison chart

**Files:**
- Create: `web/src/pages/analytics/batch-comparison-chart.tsx`
- Modify: `web/src/pages/analytics/analytics-page.tsx`

**Interfaces:**
- Consumes: the same `/analytics/batches/performance?status=RUNNING` fetch
  Task 10 introduced on the page, plus `batches` (existing `/batches?limit=100`
  fetch) for `batch_code` labels — receives both as props rather than
  fetching again, since the page already has this data.
- Produces: `<BatchComparisonChart batches={batches} performances={performances} isLoading={...} />`

- [ ] **Step 1: Create the component**

Create `web/src/pages/analytics/batch-comparison-chart.tsx`:

```tsx
import { useMemo } from "react";
import { Scale } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { CHART_HEIGHT, chartAxisProps, chartGridProps, chartTooltipContentStyle } from "@/pages/analytics/chart-theme";
import type { Batch } from "@/pages/batches/types";
import type { BatchPerformance } from "@/pages/analytics/types";

type BatchComparisonChartProps = {
  batches: Batch[];
  performances: BatchPerformance[];
  isLoading: boolean;
};

/** Semantic tone colors, not categorical -- mortality rate is a status
 * reading (good/warning/critical), the same three-way split
 * BatchPerformanceRow already uses for its badge. */
function toneColor(rate: number) {
  if (rate > 0.05) return "var(--color-destructive)";
  if (rate > 0.02) return "var(--chart-3)";
  return "var(--chart-1)";
}

export function BatchComparisonChart({ batches, performances, isLoading }: BatchComparisonChartProps) {
  const rows = useMemo(
    () =>
      performances
        .map((p) => ({
          batch_code: batches.find((b) => b.id === p.batch_id)?.batch_code ?? p.batch_id,
          mortality_rate: Number((p.cumulative_mortality_rate * 100).toFixed(1)),
        }))
        .sort((a, b) => b.mortality_rate - a.mortality_rate),
    [batches, performances],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Batch comparison — mortality rate</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <Skeleton style={{ height: CHART_HEIGHT }} className="w-full" />}
        {!isLoading && rows.length === 0 && (
          <EmptyState icon={Scale} title="No running batches" description="Comparison appears here once a batch is running." />
        )}
        {!isLoading && rows.length > 0 && (
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <BarChart data={rows} layout="vertical">
              <CartesianGrid {...chartGridProps} horizontal={false} />
              <XAxis type="number" unit="%" {...chartAxisProps} />
              <YAxis type="category" dataKey="batch_code" width={100} {...chartAxisProps} />
              <Tooltip contentStyle={chartTooltipContentStyle} formatter={(value: number) => [`${value}%`, "Mortality rate"]} />
              <Bar dataKey="mortality_rate" radius={[0, 4, 4, 0]}>
                {rows.map((row) => (
                  <Cell key={row.batch_code} fill={toneColor(row.mortality_rate / 100)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Mount it on the page**

In `web/src/pages/analytics/analytics-page.tsx`, add the import:

```ts
import { BatchComparisonChart } from "@/pages/analytics/batch-comparison-chart";
```

Add a new grid row after the mortality/feed row from Tasks 11–12:

```tsx
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BatchComparisonChart
          batches={batches?.results ?? []}
          performances={performances ?? []}
          isLoading={batchesLoading || performancesLoading}
        />
      </div>
```

(Task 14 adds the sales price trend chart as the second item here.)

- [ ] **Step 3: Manual verification**

Run the dev server. Confirm the seeded batch (2% mortality) renders one
bar in the warning color (rate > 0.02 threshold), sorted correctly if more
than one batch exists.

- [ ] **Step 4: Commit**

```bash
cd web
git add src/pages/analytics/batch-comparison-chart.tsx src/pages/analytics/analytics-page.tsx
git commit -m "feat: add batch comparison chart to Analytics page"
```

---

### Task 14: Bird-sale price trend chart

**Files:**
- Create: `web/src/pages/analytics/sales-price-trend-chart.tsx`
- Modify: `web/src/pages/analytics/analytics-page.tsx`

**Interfaces:**
- Consumes: `GET /analytics/trends/sales?days=N` (Task 3), `SalesTrendPoint`
  (Task 9), `DayRangeToggle`/`chart-theme.ts` (Task 8)
- Produces: `<SalesPriceTrendChart />` — two stacked single-series line
  charts (revenue, then avg price/kg) under one shared range toggle, not a
  dual-axis combo (see plan header's Global Constraints).

- [ ] **Step 1: Create the component**

Create `web/src/pages/analytics/sales-price-trend-chart.tsx`:

```tsx
import { useState } from "react";
import { LineChart as LineChartIcon } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { useGetData } from "@/lib/api";
import { formatMoney } from "@/lib/utils";
import { DayRangeToggle } from "@/pages/analytics/day-range-toggle";
import { CHART_HEIGHT, chartAxisProps, chartGridProps, chartTooltipContentStyle, SINGLE_SERIES_STROKE } from "@/pages/analytics/chart-theme";
import type { SalesTrendPoint } from "@/pages/analytics/types";

const MINI_HEIGHT = CHART_HEIGHT / 2 - 8;

export function SalesPriceTrendChart() {
  const [days, setDays] = useState(30);
  const { data, isLoading } = useGetData<SalesTrendPoint[]>(`/analytics/trends/sales?days=${days}`, [
    "analytics",
    "trends",
    "sales",
    days,
  ]);
  const rows = (data ?? []).map((r) => ({
    date: r.date,
    revenue: parseFloat(r.revenue),
    avg_price_per_kg: parseFloat(r.avg_price_per_kg),
  }));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Bird sales — revenue &amp; price/kg</CardTitle>
        <DayRangeToggle value={days} onValueChange={setDays} />
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {isLoading && <Skeleton style={{ height: CHART_HEIGHT }} className="w-full" />}
        {!isLoading && rows.length === 0 && (
          <EmptyState icon={LineChartIcon} title="No bird sales" description={`Nothing recorded in the last ${days} days.`} />
        )}
        {!isLoading && rows.length > 0 && (
          <>
            <p className="text-xs font-medium text-muted-foreground uppercase">Revenue</p>
            <ResponsiveContainer width="100%" height={MINI_HEIGHT}>
              <LineChart data={rows}>
                <CartesianGrid {...chartGridProps} />
                <XAxis dataKey="date" {...chartAxisProps} hide />
                <YAxis {...chartAxisProps} />
                <Tooltip contentStyle={chartTooltipContentStyle} formatter={(v: number) => formatMoney(v)} />
                <Line type="monotone" dataKey="revenue" name="Revenue" stroke={SINGLE_SERIES_STROKE} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
            <p className="text-xs font-medium text-muted-foreground uppercase">Avg price / kg</p>
            <ResponsiveContainer width="100%" height={MINI_HEIGHT}>
              <LineChart data={rows}>
                <CartesianGrid {...chartGridProps} />
                <XAxis dataKey="date" {...chartAxisProps} />
                <YAxis {...chartAxisProps} />
                <Tooltip contentStyle={chartTooltipContentStyle} formatter={(v: number) => formatMoney(v)} />
                <Line type="monotone" dataKey="avg_price_per_kg" name="Avg price/kg" stroke={SINGLE_SERIES_STROKE} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Mount it next to the batch comparison chart**

In `web/src/pages/analytics/analytics-page.tsx`, add the import:

```ts
import { SalesPriceTrendChart } from "@/pages/analytics/sales-price-trend-chart";
```

Update the grid row added in Task 13:

```tsx
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BatchComparisonChart
          batches={batches?.results ?? []}
          performances={performances ?? []}
          isLoading={batchesLoading || performancesLoading}
        />
        <SalesPriceTrendChart />
      </div>
```

- [ ] **Step 3: Manual verification**

Run the dev server, confirm both mini-charts render from the seeded bird
sale (revenue ≈118000, price ≈200/kg on today's date).

- [ ] **Step 4: Commit**

```bash
cd web
git add src/pages/analytics/sales-price-trend-chart.tsx src/pages/analytics/analytics-page.tsx
git commit -m "feat: add bird-sale price trend chart to Analytics page"
```

---

### Task 15: Revenue vs expenses chart

**Files:**
- Create: `web/src/pages/analytics/revenue-expense-chart.tsx`
- Modify: `web/src/pages/analytics/analytics-page.tsx`

**Interfaces:**
- Consumes: `GET /analytics/revenue-vs-expenses?months=6` (Task 5),
  `RevenueVsExpensesPoint` (Task 9), `chart-theme.ts` (Task 8)
- Produces: `<RevenueExpenseChart />` — fixed 6-month window, no toggle
  (per spec §4.2).

- [ ] **Step 1: Create the component**

Both series are money on the same scale — a shared single axis, not
dual-axis (bar for expenses, line for revenue, one y-axis). Create
`web/src/pages/analytics/revenue-expense-chart.tsx`:

```tsx
import { Banknote } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { useGetData } from "@/lib/api";
import { formatMoney } from "@/lib/utils";
import { CHART_HEIGHT, chartAxisProps, chartGridProps, chartTooltipContentStyle } from "@/pages/analytics/chart-theme";
import type { RevenueVsExpensesPoint } from "@/pages/analytics/types";

export function RevenueExpenseChart() {
  const { data, isLoading } = useGetData<RevenueVsExpensesPoint[]>("/analytics/revenue-vs-expenses?months=6", [
    "analytics",
    "revenue-vs-expenses",
  ]);
  const rows = (data ?? []).map((r) => ({
    month: r.month,
    revenue: parseFloat(r.revenue),
    expenses: parseFloat(r.expenses),
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Revenue vs expenses — last 6 months</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <Skeleton style={{ height: CHART_HEIGHT }} className="w-full" />}
        {!isLoading && rows.every((r) => r.revenue === 0 && r.expenses === 0) && (
          <EmptyState icon={Banknote} title="No financial activity" description="Nothing recorded in the last 6 months." />
        )}
        {!isLoading && !rows.every((r) => r.revenue === 0 && r.expenses === 0) && (
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <ComposedChart data={rows}>
              <CartesianGrid {...chartGridProps} />
              <XAxis dataKey="month" {...chartAxisProps} />
              <YAxis {...chartAxisProps} />
              <Tooltip contentStyle={chartTooltipContentStyle} formatter={(v: number) => formatMoney(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="expenses" name="Expenses" fill="var(--color-chart-2)" radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="revenue" name="Revenue" stroke="var(--color-chart-5)" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Mount it on the page**

In `web/src/pages/analytics/analytics-page.tsx`, add the import:

```ts
import { RevenueExpenseChart } from "@/pages/analytics/revenue-expense-chart";
```

Add a new grid row after the batch-comparison/sales-price row from Tasks
13–14:

```tsx
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RevenueExpenseChart />
      </div>
```

(Task 16 adds the expense breakdown chart as the second item here.)

- [ ] **Step 3: Manual verification**

Run the dev server, confirm the current month's bar+line reflect the
seeded revenue/expense figures, and the legend distinguishes the two series.

- [ ] **Step 4: Commit**

```bash
cd web
git add src/pages/analytics/revenue-expense-chart.tsx src/pages/analytics/analytics-page.tsx
git commit -m "feat: add revenue vs expenses chart to Analytics page"
```

---

### Task 16: Expense breakdown chart

**Files:**
- Create: `web/src/pages/analytics/expense-breakdown-chart.tsx`
- Modify: `web/src/pages/analytics/analytics-page.tsx`

**Interfaces:**
- Consumes: `GET /analytics/expenses/breakdown` (Task 4),
  `ExpenseBreakdownRow` (Task 9), `chart-theme.ts` (Task 8), `humanizeEnum`
  (existing `web/src/lib/utils.ts`)
- Produces: `<ExpenseBreakdownChart />` — sorted horizontal bar, top 4
  categories + "Other", per spec §4.2 (not a donut).

- [ ] **Step 1: Create the component**

Create `web/src/pages/analytics/expense-breakdown-chart.tsx`:

```tsx
import { useMemo } from "react";
import { PieChart } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { useGetData } from "@/lib/api";
import { formatMoney, humanizeEnum } from "@/lib/utils";
import { CATEGORICAL_COLORS, CHART_HEIGHT, chartAxisProps, chartGridProps, chartTooltipContentStyle, OTHER_COLOR } from "@/pages/analytics/chart-theme";
import type { ExpenseBreakdownRow } from "@/pages/analytics/types";

const TOP_N = 4;

/** Endpoint already sorts descending by total -- fold anything past the
 * fixed 4-slot categorical order into "Other" rather than generating a
 * 5th hue (dataviz skill: categorical order is fixed, never cycled). */
function topNPlusOther(rows: ExpenseBreakdownRow[]) {
  const top = rows.slice(0, TOP_N);
  const rest = rows.slice(TOP_N);
  const otherTotal = rest.reduce((sum, r) => sum + parseFloat(r.total), 0);
  const withOther = otherTotal > 0 ? [...top, { category: "OTHER", total: String(otherTotal) }] : top;
  return withOther.map((r) => ({ category: r.category, total: parseFloat(r.total) }));
}

export function ExpenseBreakdownChart() {
  const { data, isLoading } = useGetData<ExpenseBreakdownRow[]>("/analytics/expenses/breakdown", [
    "analytics",
    "expenses",
    "breakdown",
  ]);
  const rows = useMemo(() => topNPlusOther(data ?? []), [data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Expense breakdown — this month</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <Skeleton style={{ height: CHART_HEIGHT }} className="w-full" />}
        {!isLoading && rows.length === 0 && (
          <EmptyState icon={PieChart} title="No expenses this month" description="Breakdown appears here once expenses are logged." />
        )}
        {!isLoading && rows.length > 0 && (
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <BarChart data={rows} layout="vertical">
              <CartesianGrid {...chartGridProps} horizontal={false} />
              <XAxis type="number" {...chartAxisProps} />
              <YAxis type="category" dataKey="category" width={100} tickFormatter={humanizeEnum} {...chartAxisProps} />
              <Tooltip contentStyle={chartTooltipContentStyle} formatter={(v: number) => formatMoney(v)} labelFormatter={humanizeEnum} />
              <Bar dataKey="total" radius={[0, 4, 4, 0]}>
                {rows.map((row, i) => (
                  <Cell key={row.category} fill={row.category === "OTHER" ? OTHER_COLOR : CATEGORICAL_COLORS[i % CATEGORICAL_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Mount it next to the revenue/expense chart**

In `web/src/pages/analytics/analytics-page.tsx`, add the import:

```ts
import { ExpenseBreakdownChart } from "@/pages/analytics/expense-breakdown-chart";
```

Update the grid row added in Task 15:

```tsx
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RevenueExpenseChart />
        <ExpenseBreakdownChart />
      </div>
```

- [ ] **Step 3: Manual verification**

Run the dev server, confirm the seeded `VET_FEE` expense renders as a
single bar (fewer than 4 categories exist, so no "Other" bucket appears).

- [ ] **Step 4: Commit**

```bash
cd web
git add src/pages/analytics/expense-breakdown-chart.tsx src/pages/analytics/analytics-page.tsx
git commit -m "feat: add expense breakdown chart to Analytics page"
```

---

### Task 17: Alerts-by-level bar (upgrade the existing text row)

**Files:**
- Modify: `web/src/pages/analytics/analytics-page.tsx`

**Interfaces:**
- Consumes: `overview.unresolved_alerts_by_level` (already fetched on the
  page via the existing `FarmOverview` type — no new endpoint).
- Produces: no new exported component — small enough to inline in the page
  (the existing text-row block it replaces was already inline).

- [ ] **Step 1: Replace the alert-level text row with a horizontal bar**

In `web/src/pages/analytics/analytics-page.tsx`, add the recharts import
alongside the existing ones:

```ts
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartAxisProps, chartTooltipContentStyle } from "@/pages/analytics/chart-theme";
```

Replace the existing block:

```tsx
      {totalUnresolvedAlerts > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Unresolved alerts by level</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-6">
            {Object.entries(alertLevels).map(([level, count]) => (
              <div key={level} className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">{humanizeEnum(level)}</span>
                <span className="font-medium tabular-nums">{count}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
```

with:

```tsx
      {totalUnresolvedAlerts > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Unresolved alerts by level</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={Object.keys(alertLevels).length * 44 + 16}>
              <BarChart
                data={Object.entries(alertLevels).map(([level, count]) => ({ level, count }))}
                layout="vertical"
              >
                <XAxis type="number" allowDecimals={false} {...chartAxisProps} />
                <YAxis type="category" dataKey="level" width={80} tickFormatter={humanizeEnum} {...chartAxisProps} />
                <Tooltip contentStyle={chartTooltipContentStyle} labelFormatter={humanizeEnum} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {Object.keys(alertLevels).map((level) => (
                    <Cell
                      key={level}
                      fill={
                        level === "CRITICAL"
                          ? "var(--color-destructive)"
                          : level === "WARNING"
                            ? "var(--color-chart-3)"
                            : "var(--color-chart-1)"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
```

This reuses the same three-tone convention (`destructive`/`chart-3`/`chart-1`
for CRITICAL/WARNING/INFO) as `BatchComparisonChart`'s `toneColor` — icon/
label is preserved via the y-axis category labels and tooltip, satisfying
`docs/design.md` §6's "never color-alone for status" rule.

- [ ] **Step 2: Manual verification**

Seed or trigger at least one unresolved alert (or check with existing
seeded state if any exists) and confirm the bar renders with the correct
tone per level, and that the block still doesn't render at all when
`totalUnresolvedAlerts` is 0 (unchanged conditional).

- [ ] **Step 3: Commit**

```bash
cd web
git add src/pages/analytics/analytics-page.tsx
git commit -m "feat: upgrade unresolved-alerts row to a horizontal bar chart"
```

---

### Task 18: Full-page verification pass

**Files:** none (verification only)

**Interfaces:** none — this task exercises everything built in Tasks 8–17
together.

- [ ] **Step 1: Typecheck the whole web app**

Run: `cd web && bun run build`
Expected: no TypeScript errors, build succeeds

- [ ] **Step 2: Run the full backend test suite**

Run: `cd server && bun test`
Expected: all tests PASS, including every test added in Tasks 1–6

- [ ] **Step 3: Start both servers and walk the golden path**

Run: `cd server && bun --hot index.ts` (leave running), then
`cd web && bun run dev` (leave running). Open the Analytics page in a
browser.

Confirm, in order top to bottom:
1. KPI row renders (unchanged).
2. Alerts-by-level renders as a bar (or is hidden if zero unresolved alerts).
3. Mortality trend | Feed consumption trend render side by side, both
   respond to their own 7/30/90 toggle independently.
4. Batch comparison | Bird-sale price trend render side by side.
5. Revenue vs expenses | Expense breakdown render side by side.
6. Batch performance table renders with the same data as before the Task
   10 refactor, single network request.
7. "Financials & P&L →" link still navigates to `/finance`.

- [ ] **Step 4: Edge cases**

- Toggle the browser/OS to dark mode: confirm every chart line/bar remains
  clearly visible (this is what Task 8 Step 2's token fix targets).
- Temporarily point a chart's `useGetData` call at a query that returns no
  rows (e.g. filter to a date range with no data, or check behavior on a
  fresh empty database) and confirm the `EmptyState` renders instead of a
  blank chart area, for each of: mortality trend, feed trend, batch
  comparison, sales price trend, revenue/expense, expense breakdown.
- Resize the browser below 1024px width: confirm every 2-column grid row
  collapses to 1 column (matches the existing KPI row's `lg:grid-cols-3`
  breakpoint already on this page).

- [ ] **Step 5: No commit for this task** — it's verification only. If any
  step surfaces a bug, fix it in the relevant earlier task's files and
  commit that fix with a `fix:` message referencing what broke.

---

## Self-Review Notes

- **Spec coverage:** every endpoint in spec §3.1–3.6 has a task (1–6); api.md
  update is §3.7 → Task 7; every chart in spec §4.2 has a task (11 mortality,
  12 feed, 13 batch comparison, 14 sales price, 15 revenue/expense, 16
  expense breakdown, 17 alerts bar); the table refactor from spec §4.3 is
  Task 10; the layout order from spec §4.4 is realized by the grid-row
  ordering across Tasks 11–17; chart infra (recharts, tokens, dark-mode fix)
  from spec §4.1 is Task 8.
- **Dual-axis / donut corrections:** carried through from the spec edits
  made during planning — Task 14 builds two stacked single-series charts,
  not dual-axis; Task 16 builds a sorted bar, not a donut.
- **Type consistency checked:** `TrendsQuery`/`trendsQuerySchema` (Task 1) is
  reused verbatim by Tasks 2–3, not redefined. `BatchPerformance` (existing
  type) is reused as an array by Task 6/10/13, not redefined. Every chart
  component's prop/type names match what Task 9 defines.
