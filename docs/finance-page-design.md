# Finance page — design spec

Date: 2026-08-10
Status: approved, ready for implementation plan

## 1. Problem

The Finance page (`web/src/pages/finance/`) ships 4 tabs — Overview,
Expenses, Depreciation, Batch P&L — but two concrete gaps exist against
`docs/FEATURES.md` §2.10:

1. **No filters anywhere.** The spec calls for "Expense list: filter by
   category, cost type, batch, date" and "Depreciation ledger… browsable by
   asset or batch," but both tabs currently fetch an unfiltered first-100
   page and render it flat. The backend already supports `batch_id`/
   `category`/`cost_type` on `GET /expenses` and `asset_id`/`batch_id` on
   `GET /asset-depreciations` — only the date-range param and all frontend
   filter UI are missing.
2. **The "shared-period allocation queue" doesn't exist at all**, not even
   as a visibility-only list. A code comment on `finance-page.tsx` explains
   it was skipped because the bird-days formula that would *compute* the
   allocation is v2 — but that conflated "the formula" with "the queue."
   The queue (which `SHARED_PERIOD` expenses exist and are unallocated) is
   just a filtered list; it doesn't need the formula to exist.

A third, smaller gap: the Overview tab computes `outstanding_payables`
(`Purchase.due_amount` sum) but not the symmetric `outstanding_receivables`
(`Sale`/`BirdSale.due_amount` sum) — one half of "who owes whom" is simply
missing from the dashboard that's supposed to show cash position.

## 2. Scope

**In scope**: filters on Expenses and Depreciation tabs, a new
shared-period queue view, an outstanding-receivables KPI, and converting
the Overview tab's flat cash-by-instrument list into a small chart (reusing
the Analytics dashboard's chart infrastructure rather than introducing a
new pattern).

**Out of scope** (deliberate, not oversight):
- **The bird-days allocation formula.** `server/docs/system-design-arc.md`
  §7 explicitly flags this as needing "2-3 batches of real overlapping
  data to validate against before writing the formula." Building it now
  means guessing at a formula the project's own architecture doc says
  shouldn't be guessed at yet. The queue this spec adds is visibility only
  — it lists what's waiting, it does not decide how to split it.
- **Revenue/expense trend charts, expense-category breakdown.** These
  already ship on the Analytics page (`server/docs/analytics-dashboard-design.md`).
  Finance stays the point-in-time + ledger surface; Analytics owns trends.
  Duplicating them here re-litigates a split the user already approved.
- **Per-expense payment status** (paid vs. outstanding). `Payment` already
  supports `ref_type = EXPENSE` + `ref_id`, and `GET /payments/total-paid`
  already exists to compute it — but "which expenses are unpaid" is the
  Payments page's "outstanding dues" territory (`docs/FEATURES.md` §2.9),
  not Finance's ledger view. Not duplicated here.
- **DB schema changes.** Investigated and none are needed: `Expense.date`
  is already indexed, `Sale`/`BirdSale.due_amount` already exist,
  `AssetDepreciation` already stores everything the queue and filters need.
  Every gap in this spec closes with a new query param or a derived
  response field on existing tables.

## 3. Backend

### 3.1 `GET /expenses` — add date-range filtering

`server/src/validators/expense.validator.ts`'s `listExpensesQuerySchema`
gains `date_from`/`date_to` (both `z.coerce.date().optional()`).
`server/src/services/expense.service.ts`'s `getAll` adds them to the
`where` clause as `date: { gte: date_from, lte: date_to }` (only the
provided bound(s) applied — matches the existing pattern of every other
optional filter in that `where` object literal).

No new endpoint — this extends the existing `GET /expenses` list.

### 3.2 `GET /analytics/financial` — add `outstanding_receivables`

`AnalyticsService.financialDashboard` (`server/src/services/analytics.service.ts`)
gains one more parallel aggregate alongside the existing
`purchasesDue`/`instruments` calls:

```ts
prisma.sale.aggregate({ _sum: { due_amount: true } }),
prisma.birdSale.aggregate({ _sum: { due_amount: true } }),
```

summed together the same way `revenue` already combines `Sale.total` +
`BirdSale.total_amount`, and added to the response as
`outstanding_receivables: string`.

This is the same endpoint the Overview tab already calls — no new route.

### 3.3 Shared-period queue — no new endpoint

`GET /expenses?cost_type=SHARED_PERIOD` already returns exactly this list
via the existing query support (§3.1's date range applies here too, for
free). The frontend queue view is a filtered fetch, not a new backend
capability.

### 3.4 Docs

`server/docs/api.md`'s existing `GET /api/expenses` row gets `date_from?`/
`date_to?` added to its query-param column, and the `/analytics/financial`
response-shape documentation gets `outstanding_receivables` added next to
the existing `outstanding_payables` line.

## 4. Frontend

### 4.1 Expenses tab — filter row

New filter row above the table, following the exact pattern already
established on `web/src/pages/batches/batches-list-page.tsx` (a `Select`
per enum filter, driven by `useState`, built into a `URLSearchParams`
query string passed to `useGetData`):

- Category `Select` (10 `ExpenseCategory` values + "All categories")
- Cost type `Select` (3 `CostType` values + "All cost types")
- Batch `Select` (fetched batch list + "Farm-wide" + "All batches")
- Date range: two `Input type="date"` fields (`from`/`to`) — matches the
  existing `Input type="month"` convention already used by
  `overview-tab.tsx`'s month picker; no new input pattern introduced.

Filters compose into one query string; clearing a filter removes that
param rather than sending an explicit "all" sentinel to the backend.

### 4.2 Depreciation tab — filter row

Same pattern, two `Select`s: asset (fetched from `GET /assets`) and batch.
Both map straight to the already-supported `asset_id`/`batch_id` query
params — no backend change for this tab.

### 4.3 New: shared-period allocation queue

A new 5th tab, "Shared Costs" — consistent with Depreciation already
getting its own tab despite being a similarly passive/informational view;
Overview stays the at-a-glance KPI surface, not a dumping ground for every
new list. Shows:
- A running total of unallocated `SHARED_PERIOD` expense amount.
- A table of those expenses (date, category, amount, remarks) — reuses the
  existing `DataTable`/`Column` pattern from `expenses-tab.tsx`.
- A one-line label: "Awaiting bird-days allocation — the distribution
  formula is v2, not yet built (`system-design-arc.md` §7). These amounts
  are visible but not yet split across concurrent batches."

### 4.4 Overview tab — receivables KPI + cash-by-instrument chart

- Add an "Outstanding receivables" `KPICard` next to the existing
  "Outstanding payables" one, reading the new `outstanding_receivables`
  field from §3.2.
- Replace the flat `cash_by_instrument` text list with a small horizontal
  bar chart — one bar per instrument, `CATEGORICAL_COLORS` from
  `web/src/pages/analytics/chart-theme.ts` (imported, not duplicated — this
  is the first non-Analytics page to reuse that module, which is fine,
  it's already a page-agnostic theme file, not Analytics-specific logic).
  Falls back to the existing text-list rendering only in the loading/empty
  states (reuses `EmptyState`, matches every other list on this page).

### 4.5 Batch P&L tab

No changes — spec review found no gap against `docs/FEATURES.md` §2.10 for
this tab.

## 5. Testing

- Backend: extend `expense.service.test.ts` (or add one if none exists —
  check first) with a test for `date_from`/`date_to` filtering, following
  the seed-known-rows-assert-the-filter pattern already used in
  `analytics.service.test.ts`. Extend `analytics.service.test.ts`'s
  existing `financialDashboard` test to also assert
  `outstanding_receivables` against a seeded `BirdSale` with a known
  `due_amount`.
- Frontend: no existing test layer for pages in this repo (confirmed
  during the Analytics work) — matches that precedent, verified manually
  via dev server.

## 6. Open items

None — all decisions above were confirmed with the user during
brainstorming (feature list, scope, and layout approved as written).
