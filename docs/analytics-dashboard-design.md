# Analytics dashboard — design spec

Date: 2026-08-10
Status: approved, ready for implementation plan

## 1. Problem

The current Analytics page (`web/src/pages/analytics/analytics-page.tsx`) ships
only a KPI row, an alerts-by-level text list, and a per-batch performance
table. A code comment on the page explains trend charts were deliberately
skipped because building an aggregate endpoint seemed redundant — the
frontend could supposedly fetch trend data straight from
`/mortality-logs`, `/consumptions`, `/weight-records`.

That reasoning doesn't hold: none of those list endpoints support date-range
filtering (confirmed against `server/docs/api.md` and their zod validators
— only `batch_id`/`house_id`/`item_id` filters exist). A "trend" built from
them today means pulling a farm's entire unfiltered history into the browser
to bucket client-side. This spec replaces that decision: add narrow,
purpose-built aggregate endpoints and build a real charted dashboard.

## 2. Scope

**In scope**: operational + financial trend charts on the Analytics page,
backed by new read-only aggregate endpoints. A bulk batch-performance
endpoint that also lets the existing performance table drop its N+1
per-row fetch.

**Out of scope** (deliberate, not oversight):
- Duplicating Finance page content (revenue/cash/payables KPIs, per-batch
  P&L) — stays linked from Analytics, not copied.
- CSV export, global date/batch/house filter bar — not requested; each
  chart gets its own local range toggle instead of a shared filter system.
- FCR and bird-days shared-cost allocation — pre-existing, deliberate gaps
  (unit-conversion ambiguity and an undesigned v2 formula respectively).
  Untouched by this work.
- New DB indexes — existing indexes (`batch_id+date`, `house_id+date`,
  `cost_type`) cover the new queries at current farm data volumes; adding
  speculative indexes for unmeasured load is premature.

## 3. Backend

All new endpoints are read-only additions to `AnalyticsService` /
`AnalyticsController` / `analyticsRoutes`, following the existing pattern
(service does the Prisma aggregation, controller is a thin pass-through,
routes validate query with zod). No new tables, no writes.

### 3.1 `GET /analytics/trends/mortality?days=30`

Daily deaths and rate across all batches for the last N days (default 30,
zod `z.coerce.number().int().positive().max(365).optional()`).

```
Prisma.mortalityLog.groupBy({ by: ["date"], where: { date: { gte: since } }, _sum: { count_died: true } })
```

Response: `{ date: string (YYYY-MM-DD), died: number }[]`, one row per day
that has at least one log (no zero-fill — the chart component fills gaps
client-side so the endpoint stays a straight aggregation).

### 3.2 `GET /analytics/trends/feed?days=30`

Daily FEED-category consumption quantity. Joins `Consumption` → `Item`
filtered to `category: "FEED"`, grouped by date **and** the item's `unit`
(quantities in different units, e.g. BAG vs KG, must not be summed
together — same reasoning as the existing FCR gap).

```
prisma.consumption.findMany({
  where: { date: { gte: since }, item: { category: "FEED" } },
  select: { date: true, quantity: true, item: { select: { unit: true } } },
})
```
then group in-memory by `(date, unit)` — a raw groupBy can't reach through
the `item` relation for the unit field.

Response: `{ date: string, unit: string, quantity: string }[]` (quantity as
string — Decimal, same convention as every other money/quantity field in
this API per `docs/api.md`).

### 3.3 `GET /analytics/trends/sales?days=30`

Daily bird-sale revenue and volume-weighted avg price/kg, last N days.

```
prisma.birdSale.groupBy({
  by: ["sale_date"],
  where: { sale_date: { gte: since } },
  _sum: { total_amount: true, net_weight: true },
})
```
`avg_price_per_kg = total_amount / net_weight` computed in the service
(volume-weighted, not an average of averages).

Response: `{ date: string, revenue: string, avg_price_per_kg: string }[]`.

### 3.4 `GET /analytics/expenses/breakdown?month=YYYY-MM-DD`

Reuses the same month-resolution pattern as the existing
`financialDashboard` (defaults to current month if omitted).

```
prisma.expense.groupBy({ by: ["category"], where: { date: { gte: monthStart, lt: monthEnd } }, _sum: { amount: true } })
```

Response: `{ category: ExpenseCategory, total: string }[]`.

### 3.5 `GET /analytics/revenue-vs-expenses?months=6`

Monthly revenue (`Sale.total` + `BirdSale.total_amount`) vs monthly
`Expense.amount`, for the last N months (default 6, max 24). Computed as N
parallel `Promise.all` month-window aggregates — same shape as
`financialDashboard`'s single-month version, just looped, so it stays
consistent with the existing per-month computation rather than inventing a
different SQL date-bucketing approach.

Response: `{ month: string (YYYY-MM), revenue: string, expenses: string }[]`.

### 3.6 `GET /analytics/batches/performance?status=RUNNING`

Bulk version of the existing `GET /analytics/batches/:id/performance`.
Same per-batch fields, one query for all matching batches instead of one
request per batch. `status` optional, defaults to `RUNNING` (the set the
existing table and new comparison chart both care about).

Response: `BatchPerformance[]` (same shape as the existing single-batch
endpoint, array instead of one object).

The existing `GET /analytics/batches/:id/performance` stays — batch detail
pages still use the single version.

### 3.7 Docs

`server/docs/api.md` gets a new `### 12.x Analytics trends` subsection
listing all six new routes (method, path, query params, response shape),
following the existing table format used for the other Analytics routes.

## 4. Frontend

### 4.1 Chart library

No chart library is installed. Add **Recharts** — it's what the existing
`--chart-1..5` CSS tokens in `index.css` are provisioned for, and it's the
standard pairing with shadcn (`docs/design.md` §2.4 already assumes a chart
palette exists, it just has no renderer yet). Wrap it in a small shared
`ChartContainer` following shadcn's chart primitive pattern so tooltip/
legend/theming is defined once, not per chart.

Single-series charts (mortality, feed, sales price) use the grayscale
`chart-1..5` ramp per `docs/design.md` §2.4. The expense breakdown donut is
categorical (5+ distinct categories) — pulls from the **dataviz** skill's
categorical palette instead, per the same doc section. Loaded at
implementation time, not during this design pass.

### 4.2 New components (`web/src/pages/analytics/`)

- `mortality-trend-chart.tsx` — line chart, local 7/30/90-day toggle.
- `feed-trend-chart.tsx` — bar chart, same toggle. Renders one series per
  distinct `unit` returned (usually one).
- `batch-comparison-chart.tsx` — horizontal bar, mortality rate % per
  running batch, worst→best. Also becomes the new data source for the
  existing performance table (see 4.3).
- `sales-price-trend-chart.tsx` — 7/30/90-day toggle, two stacked
  single-series line charts (revenue, then avg price/kg) sharing one toggle.
  Not a dual-axis combo: the dataviz skill treats dual-axis as the #1 chart
  anti-pattern (two y-scales invite false correlation) — two measures of
  different scale become two small charts instead.
- `revenue-expense-chart.tsx` — combo bar (expenses) + line (revenue),
  fixed 6-month window.
- `expense-breakdown-chart.tsx` — sorted horizontal bar, current month,
  categorical colors. Not a donut: the dataviz skill explicitly deprioritizes
  donut/pie ("part-to-whole rides on the stacked bar chart") and flags
  pie-for-close-values as an anti-pattern. Top 4 categories by amount get
  their own categorical slot (blue/orange/aqua/yellow, the dataviz reference
  palette's validated adjacent-pair order); the rest fold into a neutral-gray
  "Other" bar — `ExpenseCategory` has 10 values, past 4 slots the palette's
  own guidance is to fold rather than keep generating hues.
- `alerts-by-level-chart.tsx` — small horizontal bar replacing the current
  plain-text row inside the existing alerts Card.

Each trend chart component owns its own `useGetData` call and its own
range-toggle state — no shared global filter state, per the scope decision
in §2.

### 4.3 Batch performance table refactor

`analytics-page.tsx` currently fetches `/batches?limit=100` and renders one
`BatchPerformanceRow` per batch, each independently calling
`/analytics/batches/:id/performance` (documented N+1, justified in-code by
small batch counts). Since the new comparison chart needs the same bulk
data anyway, switch the table to consume the new
`/analytics/batches/performance` response directly — one fetch instead of
N, `BatchPerformanceRow` becomes a plain presentational row taking
`performance` as a prop instead of fetching it itself. This removes the N+1
comment's justification rather than leaving two competing patterns on the
same page.

### 4.4 Page layout (top to bottom)

1. KPI row — unchanged (`active batches`, `birds alive`, `houses`,
   `employees`, `unresolved alerts`).
2. Alerts-by-level — same Card, text row replaced by the small bar chart.
3. 2-col grid: mortality trend | feed consumption trend.
4. 2-col grid: batch comparison bar | bird-sale price trend.
5. 2-col grid: revenue vs expenses (6mo) | expense breakdown donut.
6. Batch performance table — unchanged content/columns, bulk-fed per §4.3.
7. "Financials & P&L →" link to Finance — unchanged.

Grid collapses to 1 column below `lg` (matches the existing KPI row's
`lg:grid-cols-3` breakpoint convention already on this page).

Empty states: every chart needs one — reuse the existing `EmptyState`
shared component (icon + line + no action button needed here, these are
read-only) when its endpoint returns an empty array, consistent with
`docs/design.md` §5's "never ship a blank table with no explanation" rule
extended to charts.

## 5. Testing

- Backend: extend `analytics.service.test.ts` with one test per new
  aggregate function, following the existing pattern (seed known rows in
  `beforeAll`, assert the aggregate math, e.g. mortality trend returns the
  seeded day's `died` count; expense breakdown returns the seeded
  `VET_FEE` total; revenue-vs-expenses' current month includes the seeded
  bird sale).
- Frontend: no existing test setup for pages in this repo (none found for
  `analytics-page.tsx` or `finance-page.tsx`) — matches the existing
  pattern of backend-only automated tests, frontend verified manually via
  dev server. Not introducing a new test layer for this page alone.

## 6. Open items

None — all decisions above were confirmed with the user during
brainstorming (backend aggregates approved over client-side aggregation;
full feature list and layout approved as written).
