# Finance Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real filters to the Expenses and Depreciation tabs, a
visibility-only "Shared Costs" queue tab, an outstanding-receivables KPI,
and a cash-by-instrument chart to the Finance page.

**Architecture:** Backend adds one query-param extension (`GET /expenses`
date range) and one new response field (`financialDashboard`'s
`outstanding_receivables`) to existing endpoints — no new routes, no schema
change. Frontend adds filter UI following the app's existing
Select-driven-by-`useState`-into-`URLSearchParams` pattern
(`web/src/pages/batches/batches-list-page.tsx`), a new 5th Finance tab, and
reuses the Analytics dashboard's `chart-theme.ts` for one small chart.

**Tech Stack:** Bun, Hono, Prisma, Zod (backend) · React 19, TanStack
Query, Recharts + `chart-theme.ts` (already installed/built by the
Analytics work), react-hook-form + zod (frontend forms, unchanged).

**Spec:** `server/docs/finance-page-design.md` — read it before starting;
every task below implements one numbered section of it.

## Global Constraints

- Money fields are always JSON strings on the wire (Decimal → string) per
  `docs/api.md` §1.9 — the new `outstanding_receivables` field follows this.
- Filters compose into a query string; clearing a filter removes that
  param entirely rather than sending an "ALL" sentinel to the backend
  (matches `batches-list-page.tsx`'s existing pattern).
- No DB schema changes — every gap closes with a query param or a derived
  response field on tables that already have what's needed.
- The bird-days allocation formula itself is explicitly out of scope
  (`system-design-arc.md` §7) — the Shared Costs tab is visibility only.
- Colors only through CSS variable tokens, reusing
  `web/src/pages/analytics/chart-theme.ts` — no new hex/oklch literals.

---

## Part A — Backend (`server/`)

### Task 1: `GET /expenses` date-range filter

**Files:**
- Modify: `server/src/validators/expense.validator.ts`
- Modify: `server/src/services/expense.service.ts`
- Modify: `server/src/services/expense.service.test.ts`

**Interfaces:**
- Produces: `listExpensesQuerySchema` gains `date_from?: Date`,
  `date_to?: Date` (both `z.coerce.date().optional()`)
- No route/controller change — `expense.routes.ts` already validates
  `query` against `listExpensesQuerySchema` and passes it straight through.

- [ ] **Step 1: Add the query params to the schema**

In `server/src/validators/expense.validator.ts`, update
`listExpensesQuerySchema`:

```ts
export const listExpensesQuerySchema = paginationQuerySchema.extend({
    batch_id: z.string().uuid().optional(),
    category: expenseCategory.optional(),
    cost_type: costType.optional(),
    date_from: z.coerce.date().optional(),
    date_to: z.coerce.date().optional(),
});
```

- [ ] **Step 2: Write the failing test**

Append to `server/src/services/expense.service.test.ts`, inside the
existing `describe("ExpenseService", ...)` block:

```ts
    test("listing filters by date range", async () => {
        const inRange = await ExpenseService.create({
            category: "FUEL",
            cost_type: "DIRECT",
            amount: 800,
            date: new Date("2026-03-15"),
            recorded_by_id: profileId,
        });
        createdIds.push(inRange!.id);
        const outOfRange = await ExpenseService.create({
            category: "FUEL",
            cost_type: "DIRECT",
            amount: 900,
            date: new Date("2026-06-01"),
            recorded_by_id: profileId,
        });
        createdIds.push(outOfRange!.id);

        const { expenses } = await ExpenseService.getAll({
            page: 1,
            limit: 100,
            date_from: new Date("2026-03-01"),
            date_to: new Date("2026-03-31"),
        });
        expect(expenses.some((e) => e.id === inRange!.id)).toBe(true);
        expect(expenses.some((e) => e.id === outOfRange!.id)).toBe(false);
    });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server && bun test src/services/expense.service.test.ts -t "date range"`
Expected: FAIL — `date_from`/`date_to` aren't applied yet, both expenses
returned (or a type error if `getAll`'s param type doesn't accept them yet)

- [ ] **Step 4: Implement the filter**

In `server/src/services/expense.service.ts`, update `getAll`'s `where`:

```ts
    async getAll(query: ListExpensesQuery) {
        const where = {
            ...(query.batch_id !== undefined && { batch_id: query.batch_id }),
            ...(query.category !== undefined && { category: query.category }),
            ...(query.cost_type !== undefined && { cost_type: query.cost_type }),
            ...((query.date_from !== undefined || query.date_to !== undefined) && {
                date: {
                    ...(query.date_from !== undefined && { gte: query.date_from }),
                    ...(query.date_to !== undefined && { lte: query.date_to }),
                },
            }),
        };
```

(Rest of the function unchanged.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && bun test src/services/expense.service.test.ts -t "date range"`
Expected: PASS

- [ ] **Step 6: Run the full expense test file to confirm no regressions**

Run: `cd server && bun test src/services/expense.service.test.ts`
Expected: all tests PASS

- [ ] **Step 7: Commit**

```bash
cd server
git add src/validators/expense.validator.ts src/services/expense.service.ts src/services/expense.service.test.ts
git commit -m "feat: add date-range filter to GET /expenses"
```

---

### Task 2: `outstanding_receivables` on the financial dashboard

**Files:**
- Modify: `server/src/services/analytics.service.ts`
- Modify: `server/src/services/analytics.service.test.ts`

**Interfaces:**
- Produces: `AnalyticsService.financialDashboard` response gains
  `outstanding_receivables: string`
- No new route — this is the existing `GET /analytics/financial` endpoint.

- [ ] **Step 1: Write the failing test**

The existing `analytics.service.test.ts` fixture already seeds one
`BirdSale` with `paid_amount: 0` against a `total_amount` of 118000 (see
the shared `beforeAll` — `net_weight: 590`, `price_per_kg: 200`), so
`due_amount` for that sale is the full 118000. Extend the existing
`financialDashboard` test:

```ts
    test("financialDashboard includes this batch's bird sale revenue and expense for the current month", async () => {
        const dashboard = await AnalyticsService.financialDashboard({});
        expect(dashboard.revenue.toNumber()).toBeGreaterThanOrEqual(118000);
        expect(dashboard.expenses.toNumber()).toBeGreaterThanOrEqual(2000);
        expect(dashboard.outstanding_receivables.toNumber()).toBeGreaterThanOrEqual(118000);
    });
```

(This replaces the existing test of the same name — same body, one new
assertion appended. Confirm the exact current assertions first by reading
the file, since this plan's other backend tasks may have touched nearby
lines.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && bun test src/services/analytics.service.test.ts -t "financialDashboard"`
Expected: FAIL — `dashboard.outstanding_receivables` is `undefined`

- [ ] **Step 3: Implement the field**

In `server/src/services/analytics.service.ts`, find `financialDashboard`
and add two parallel aggregates alongside the existing ones:

```ts
    async financialDashboard(query: FinancialDashboardQuery) {
        const month = query.month ?? new Date();
        const monthStart = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
        const monthEnd = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));

        const [saleRevenue, birdSaleRevenue, expenses, purchasesDue, salesDue, birdSalesDue, instruments] =
            await Promise.all([
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
                prisma.purchase.aggregate({ _sum: { due_amount: true } }),
                prisma.sale.aggregate({ _sum: { due_amount: true } }),
                prisma.birdSale.aggregate({ _sum: { due_amount: true } }),
                prisma.paymentInstrument.findMany({ where: { is_active: true } }),
            ]);

        const revenue = (saleRevenue._sum.total ?? new Prisma.Decimal(0)).plus(
            birdSaleRevenue._sum.total_amount ?? new Prisma.Decimal(0),
        );
        const expenseTotal = expenses._sum.amount ?? new Prisma.Decimal(0);
        const outstandingReceivables = (salesDue._sum.due_amount ?? new Prisma.Decimal(0)).plus(
            birdSalesDue._sum.due_amount ?? new Prisma.Decimal(0),
        ); // raw Prisma.Decimal, not .toString()'d -- matches every sibling

        const balances = await Promise.all(
            instruments.map((inst) => PaymentInstrumentService.getBalance(inst.id)),
        );
        const cashPosition = balances.reduce(
            (sum, b) => sum.plus(b.balance),
            new Prisma.Decimal(0),
        );

        return {
            month: monthStart.toISOString().slice(0, 7),
            revenue,
            expenses: expenseTotal,
            gross_profit: revenue.minus(expenseTotal),
            outstanding_payables: purchasesDue._sum.due_amount ?? new Prisma.Decimal(0),
            outstanding_receivables: outstandingReceivables,
            cash_position: cashPosition,
            cash_by_instrument: instruments.map((inst, i) => ({
                instrument_id: inst.id,
                label: inst.label,
                balance: balances[i]!.balance,
            })),
        };
    },
```

`outstanding_receivables` is returned as a raw `Prisma.Decimal`, matching
every sibling field in this response (`revenue`, `expenses`,
`outstanding_payables`, `cash_position` are all raw `Prisma.Decimal` too)
— Prisma's Decimal has its own `toJSON()`, so Hono's `c.json()` serializes
it to a string automatically, same as every other money field in this API
per `docs/api.md` §1.9. No explicit `.toString()` needed or wanted here.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && bun test src/services/analytics.service.test.ts -t "financialDashboard"`
Expected: PASS

- [ ] **Step 5: Run the full analytics test file to confirm no regressions**

Run: `cd server && bun test src/services/analytics.service.test.ts`
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
cd server
git add src/services/analytics.service.ts src/services/analytics.service.test.ts
git commit -m "feat: add outstanding_receivables to financial dashboard"
```

---

### Task 3: Document both backend changes in api.md

**Files:**
- Modify: `server/docs/api.md`

- [ ] **Step 1: Update the `GET /expenses` row**

Run: `grep -n "GET.*api/expenses\b" docs/api.md` to find the existing row
and its query-param documentation. Add `date_from?` and `date_to?` (both
dates) to the documented query params, following whatever format the
existing `batch_id?`/`category?`/`cost_type?` params use in that row.

- [ ] **Step 2: Update the `/analytics/financial` response documentation**

Run: `grep -n "outstanding_payables" docs/api.md` to find where the
financial dashboard's response shape is documented. Add
`outstanding_receivables: string` immediately after
`outstanding_payables`, with a one-line description ("`Sale` +
`BirdSale.due_amount` sum — the receivables half of `outstanding_payables`").

- [ ] **Step 3: Commit**

```bash
cd server
git add docs/api.md
git commit -m "docs: document expense date-range filter and outstanding_receivables"
```

---

## Part B — Frontend (`web/`)

### Task 4: Finance types — receivables field, minimal Asset type

**Files:**
- Modify: `web/src/pages/finance/types.ts`

**Interfaces:**
- Produces: `FinancialDashboard.outstanding_receivables: string`
- Produces: `FinanceAsset` type (`{ id: string; name: string }`) — no
  frontend `Asset` type exists anywhere in this codebase yet (Assets
  CRUD isn't built on the frontend, out of scope here); this is a minimal
  local type just for the Depreciation tab's filter dropdown, not a full
  Asset model.

- [ ] **Step 1: Add the field and type**

In `web/src/pages/finance/types.ts`, update `FinancialDashboard`:

```ts
export type FinancialDashboard = {
  month: string;
  revenue: string;
  expenses: string;
  gross_profit: string;
  outstanding_payables: string;
  outstanding_receivables: string;
  cash_position: string;
  cash_by_instrument: { instrument_id: string; label: string; balance: string }[];
};
```

Append:

```ts
export type FinanceAsset = {
  id: string;
  name: string;
};
```

- [ ] **Step 2: Typecheck**

Run: `cd web && bunx tsc -b --noEmit`
Expected: no errors (existing consumers of `FinancialDashboard` don't
destructure `outstanding_receivables` yet, so nothing breaks by adding an
optional-shaped field to a type consumers already read loosely)

- [ ] **Step 3: Commit**

```bash
cd web
git add src/pages/finance/types.ts
git commit -m "feat: add outstanding_receivables and FinanceAsset types"
```

---

### Task 5: Expenses tab filter row

**Files:**
- Modify: `web/src/pages/finance/expenses-tab.tsx`

**Interfaces:**
- Consumes: `GET /expenses` with `category`/`cost_type`/`batch_id`/
  `date_from`/`date_to` query params (Task 1 added the date ones; the
  others already existed)
- Consumes: `EXPENSE_CATEGORIES`, `COST_TYPES` (existing, from
  `web/src/pages/finance/types.ts`)

- [ ] **Step 1: Add filter state and build the query string**

In `web/src/pages/finance/expenses-tab.tsx`, add imports:

```ts
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { COST_TYPES, EXPENSE_CATEGORIES } from "@/pages/finance/types";
```

Replace the component's data-fetching section:

```tsx
export function ExpensesTab() {
  const [createOpen, setCreateOpen] = useState(false);
  const [category, setCategory] = useState<string>("ALL");
  const [costType, setCostType] = useState<string>("ALL");
  const [batchId, setBatchId] = useState<string>("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const query = new URLSearchParams({ limit: "100" });
  if (category !== "ALL") query.set("category", category);
  if (costType !== "ALL") query.set("cost_type", costType);
  if (batchId !== "ALL") query.set("batch_id", batchId);
  if (dateFrom) query.set("date_from", dateFrom);
  if (dateTo) query.set("date_to", dateTo);

  const { data, isLoading } = useGetData<Paginated<Expense>>(`/expenses?${query}`, [
    "expenses",
    category,
    costType,
    batchId,
    dateFrom,
    dateTo,
  ]);
  const { data: batches } = useGetData<Paginated<Batch>>("/batches?limit=100", ["batches"]);
  const batchCode = (id: string | null) => (id ? batches?.results.find((b) => b.id === id)?.batch_code ?? "—" : "Farm-wide");
```

(The rest of the function — `expenses`, `total`, `directTotal`, `columns`
— is unchanged; they already derive from `data`.)

- [ ] **Step 2: Render the filter row above the table**

Insert this block between the "Record expense" button row and the
`<DataTable>` call:

```tsx
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Category</Label>
          <Select value={category} onValueChange={(v) => setCategory(v ?? "ALL")}>
            <SelectTrigger className="w-40">
              <SelectValue>{(v: string) => (v === "ALL" ? "All categories" : humanizeEnum(v))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All categories</SelectItem>
              {EXPENSE_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {humanizeEnum(c)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Cost type</Label>
          <Select value={costType} onValueChange={(v) => setCostType(v ?? "ALL")}>
            <SelectTrigger className="w-40">
              <SelectValue>{(v: string) => (v === "ALL" ? "All cost types" : humanizeEnum(v))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All cost types</SelectItem>
              {COST_TYPES.map((c) => (
                <SelectItem key={c} value={c}>
                  {humanizeEnum(c)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Batch</Label>
          <Select value={batchId} onValueChange={(v) => setBatchId(v ?? "ALL")}>
            <SelectTrigger className="w-40">
              <SelectValue>
                {(v: string) => (v === "ALL" ? "All batches" : batches?.results.find((b) => b.id === v)?.batch_code ?? "—")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All batches</SelectItem>
              {(batches?.results ?? []).map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.batch_code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="date-from">From</Label>
          <Input id="date-from" type="date" className="w-40" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="date-to">To</Label>
          <Input id="date-to" type="date" className="w-40" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
        {(category !== "ALL" || costType !== "ALL" || batchId !== "ALL" || dateFrom || dateTo) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setCategory("ALL");
              setCostType("ALL");
              setBatchId("ALL");
              setDateFrom("");
              setDateTo("");
            }}
          >
            Clear filters
          </Button>
        )}
      </div>
```

- [ ] **Step 3: Typecheck**

Run: `cd web && bunx tsc -b --noEmit`
Expected: no errors

- [ ] **Step 4: Manual verification**

Run `cd web && bun run dev`, open Finance → Expenses. Confirm: each filter
independently narrows the table, "Clear filters" appears only when at
least one filter is active and resets all five, and the KPI cards above
still reflect the *filtered* result set (they already derive from `data`,
so this should be automatic — just confirm it visually).

- [ ] **Step 5: Commit**

```bash
cd web
git add src/pages/finance/expenses-tab.tsx
git commit -m "feat: add category/cost-type/batch/date filters to Expenses tab"
```

---

### Task 6: Depreciation tab filter row

**Files:**
- Modify: `web/src/pages/finance/depreciation-tab.tsx`

**Interfaces:**
- Consumes: `GET /asset-depreciations` with `asset_id`/`batch_id` (both
  already supported server-side, per spec §3.4 — no backend change here)
- Consumes: `GET /assets?limit=100` (existing endpoint, new consumer),
  `FinanceAsset` type (Task 4)

- [ ] **Step 1: Add filter state and the asset fetch**

In `web/src/pages/finance/depreciation-tab.tsx`, add imports:

```ts
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import type { FinanceAsset } from "@/pages/finance/types";
```

Update the component:

```tsx
export function DepreciationTab() {
  const [assetId, setAssetId] = useState("ALL");
  const [batchId, setBatchId] = useState("ALL");

  const query = new URLSearchParams({ limit: "100" });
  if (assetId !== "ALL") query.set("asset_id", assetId);
  if (batchId !== "ALL") query.set("batch_id", batchId);

  const { data, isLoading } = useGetData<Paginated<AssetDepreciation>>(`/asset-depreciations?${query}`, [
    "asset-depreciations",
    assetId,
    batchId,
  ]);
  const { data: batches } = useGetData<Paginated<Batch>>("/batches?limit=100", ["batches"]);
  const { data: assets } = useGetData<Paginated<FinanceAsset>>("/assets?limit=100", ["assets"]);
  const batchCode = (id: string) => batches?.results.find((b) => b.id === id)?.batch_code ?? "—";
```

- [ ] **Step 2: Render the filter row**

Insert above the existing helper `<p>` line:

```tsx
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Asset</Label>
          <Select value={assetId} onValueChange={(v) => setAssetId(v ?? "ALL")}>
            <SelectTrigger className="w-48">
              <SelectValue>
                {(v: string) => (v === "ALL" ? "All assets" : assets?.results.find((a) => a.id === v)?.name ?? "—")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All assets</SelectItem>
              {(assets?.results ?? []).map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Batch</Label>
          <Select value={batchId} onValueChange={(v) => setBatchId(v ?? "ALL")}>
            <SelectTrigger className="w-40">
              <SelectValue>
                {(v: string) => (v === "ALL" ? "All batches" : batches?.results.find((b) => b.id === v)?.batch_code ?? "—")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All batches</SelectItem>
              {(batches?.results ?? []).map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.batch_code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
```

- [ ] **Step 3: Typecheck**

Run: `cd web && bunx tsc -b --noEmit`
Expected: no errors

- [ ] **Step 4: Manual verification**

Run the dev server, open Finance → Depreciation. Confirm both filters
narrow the table independently. If the dev DB has no assets/depreciation
rows yet, confirm the dropdowns still render correctly with just the "All
X" option and an empty table shows the existing `EmptyState`.

- [ ] **Step 5: Commit**

```bash
cd web
git add src/pages/finance/depreciation-tab.tsx
git commit -m "feat: add asset/batch filters to Depreciation tab"
```

---

### Task 7: Shared Costs tab (allocation queue)

**Files:**
- Create: `web/src/pages/finance/shared-costs-tab.tsx`
- Modify: `web/src/pages/finance/finance-page.tsx`

**Interfaces:**
- Consumes: `GET /expenses?cost_type=SHARED_PERIOD` (existing filter, no
  backend change)
- Produces: `<SharedCostsTab />`

- [ ] **Step 1: Create the component**

Create `web/src/pages/finance/shared-costs-tab.tsx`:

```tsx
import { Layers } from "lucide-react";
import { DataTable, type Column } from "@/components/shared/data-table";
import { KPICard } from "@/components/shared/kpi-card";
import { useGetData, type Paginated } from "@/lib/api";
import { formatMoney, humanizeEnum } from "@/lib/utils";
import type { Expense } from "@/pages/finance/types";

/** Visibility only -- the bird-days formula that would actually distribute
 * these amounts across concurrent batches is v2, not built yet
 * (system-design-arc.md §7, needs 2-3 batches of real overlapping data to
 * validate against). This tab shows what's waiting; it doesn't decide how
 * to split it. */
export function SharedCostsTab() {
  const { data, isLoading } = useGetData<Paginated<Expense>>("/expenses?cost_type=SHARED_PERIOD&limit=100", [
    "expenses",
    "SHARED_PERIOD",
  ]);

  const expenses = data?.results ?? [];
  const total = expenses.reduce((sum, e) => sum + parseFloat(e.amount), 0);

  const columns: Column<Expense>[] = [
    { key: "date", header: "Date", render: (e) => new Date(e.date).toLocaleDateString() },
    { key: "category", header: "Category", render: (e) => humanizeEnum(e.category) },
    { key: "amount", header: "Amount", render: (e) => formatMoney(e.amount), numeric: true },
    { key: "remarks", header: "Remarks", render: (e) => e.remarks ?? "—" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <KPICard label="Unallocated shared-period costs" value={formatMoney(total)} icon={Layers} isLoading={isLoading} />
      </div>

      <p className="text-xs text-muted-foreground">
        Awaiting bird-days allocation — the distribution formula is v2, not yet built. These amounts are visible but
        not yet split across concurrent batches.
      </p>

      <DataTable
        columns={columns}
        rows={expenses}
        rowKey={(e) => e.id}
        isLoading={isLoading}
        empty={{
          icon: Layers,
          title: "No shared-period costs recorded",
          description: "Shared-period expenses appear here once logged from the Expenses tab.",
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Add the 5th tab**

In `web/src/pages/finance/finance-page.tsx`, add the import:

```ts
import { SharedCostsTab } from "@/pages/finance/shared-costs-tab";
```

Add a `TabsTrigger`/`TabsContent` pair after "Depreciation" and before
"Batch P&L":

```tsx
        <TabsTrigger value="shared-costs">Shared Costs</TabsTrigger>
```

```tsx
      <TabsContent value="shared-costs">
        <SharedCostsTab />
      </TabsContent>
```

Also update the file's existing top-of-file ponytail comment (currently
explains why there's no "shared-period allocation queue" tab) — that
comment is now stale since this task adds exactly that. Delete it or
replace with: `// The bird-days formula itself stays v2 (system-design-arc.md §7) — see SharedCostsTab for the visibility-only queue.`

- [ ] **Step 3: Typecheck**

Run: `cd web && bunx tsc -b --noEmit`
Expected: no errors

- [ ] **Step 4: Manual verification**

Run the dev server, open Finance. Confirm the new "Shared Costs" tab
appears between Depreciation and Batch P&L, shows the correct total and
list, and the empty state renders correctly if no `SHARED_PERIOD` expenses
exist in the dev DB.

- [ ] **Step 5: Commit**

```bash
cd web
git add src/pages/finance/shared-costs-tab.tsx src/pages/finance/finance-page.tsx
git commit -m "feat: add Shared Costs allocation-queue tab to Finance page"
```

---

### Task 8: Overview tab — receivables KPI + cash-by-instrument chart

**Files:**
- Modify: `web/src/pages/finance/overview-tab.tsx`

**Interfaces:**
- Consumes: `FinancialDashboard.outstanding_receivables` (Task 2 backend,
  Task 4 type)
- Consumes: `CATEGORICAL_COLORS`, `OTHER_COLOR`, `CHART_HEIGHT`,
  `chartAxisProps`, `chartGridProps`, `chartTooltipContentStyle` from
  `web/src/pages/analytics/chart-theme.ts` (already built, this is its
  first non-Analytics consumer — it's a page-agnostic theme module, not
  Analytics-specific logic, so importing across the page boundary is fine)

- [ ] **Step 1: Add the receivables KPI card**

In `web/src/pages/finance/overview-tab.tsx`, add a `KPICard` immediately
after the existing "Outstanding payables" one:

```tsx
        <KPICard
          label="Outstanding receivables"
          value={data ? formatMoney(data.outstanding_receivables) : "—"}
          icon={Wallet}
          isLoading={isLoading}
        />
```

- [ ] **Step 2: Replace the cash-by-instrument list with a bar chart**

Add imports:

```ts
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TooltipValueType } from "recharts";
import {
  CATEGORICAL_COLORS,
  CHART_HEIGHT,
  chartAxisProps,
  chartGridProps,
  chartTooltipContentStyle,
  OTHER_COLOR,
} from "@/pages/analytics/chart-theme";
```

Replace the "Cash by instrument" `<Card>` block's `<CardContent>`. Fold
past the first 4 instruments into "Other," matching the exact pattern
`expense-breakdown-chart.tsx` already established (fixed categorical order,
never cycled):

```tsx
        <CardContent>
          {isLoading && <Skeleton style={{ height: CHART_HEIGHT }} className="w-full" />}
          {!isLoading && (data?.cash_by_instrument.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">No payment instruments yet.</p>
          )}
          {!isLoading && (data?.cash_by_instrument.length ?? 0) > 0 && (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <BarChart data={instrumentRows} layout="vertical">
                <CartesianGrid {...chartGridProps} vertical horizontal={false} />
                <XAxis type="number" {...chartAxisProps} />
                <YAxis type="category" dataKey="label" width={120} {...chartAxisProps} />
                <Tooltip
                  contentStyle={chartTooltipContentStyle}
                  formatter={(v: TooltipValueType | undefined) => formatMoney(typeof v === "number" ? v : Number(v))}
                />
                <Bar dataKey="balance" radius={[0, 4, 4, 0]}>
                  {instrumentRows.map((row, i) => (
                    <Cell key={row.label} fill={row.label === "Other" ? OTHER_COLOR : CATEGORICAL_COLORS[i % CATEGORICAL_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
```

Add the row-folding logic above the `return`, inside the component:

```ts
  const instrumentRows = useMemo(() => {
    const rows = data?.cash_by_instrument ?? [];
    const top = rows.slice(0, 4);
    const rest = rows.slice(4);
    const otherTotal = rest.reduce((sum, r) => sum + parseFloat(r.balance), 0);
    const withOther = otherTotal !== 0 ? [...top, { instrument_id: "other", label: "Other", balance: String(otherTotal) }] : top;
    return withOther.map((r) => ({ label: r.label, balance: parseFloat(r.balance) }));
  }, [data]);
```

(Note `otherTotal !== 0` rather than `> 0` here, unlike the expense
breakdown's `> 0` guard — a cash balance can legitimately be negative
(overdrawn/overpayment), so folding only when the remainder is exactly
zero, not just non-positive, avoids silently hiding a negative "Other"
balance a farm operator would want to see.)

- [ ] **Step 3: Typecheck**

Run: `cd web && bunx tsc -b --noEmit`
Expected: no errors

- [ ] **Step 4: Manual verification**

Run the dev server, open Finance → Overview. Confirm the receivables KPI
shows a value, the cash-by-instrument chart renders one bar per
instrument (or "No payment instruments yet." if none exist), and dark
mode keeps every bar clearly visible (reusing the already-fixed
`chart-theme.ts` tokens from the Analytics work, so this should just work
— but look at it, don't assume).

- [ ] **Step 5: Commit**

```bash
cd web
git add src/pages/finance/overview-tab.tsx
git commit -m "feat: add outstanding receivables KPI and cash-by-instrument chart to Finance overview"
```

---

### Task 9: Full Finance page verification pass

**Files:** none (verification only)

- [ ] **Step 1: Backend tests**

Run: `cd server && bun test`
Expected: all tests PASS (including Tasks 1-2's new tests)

- [ ] **Step 2: Frontend build**

Run: `cd web && bun run build`
Expected: no TypeScript errors, build succeeds

- [ ] **Step 3: Live walkthrough**

Start both dev servers. Open Finance and walk all 5 tabs:
1. Overview — KPI row (5 cards now, including receivables) → cash-by-
   instrument chart.
2. Expenses — filter row narrows the table and KPIs together; "Clear
   filters" works; "Record expense" dialog still works unchanged.
3. Depreciation — asset/batch filters narrow the table.
4. Shared Costs — total + list of `SHARED_PERIOD` expenses only (cross-
   check against the Expenses tab filtered to the same cost type — the
   two should show the same rows).
5. Batch P&L — unchanged, still works.

- [ ] **Step 4: Dark mode + empty states**

Switch to dark mode (no in-app toggle exists per the Analytics work's
finding — force the `dark` class on `<html>`). Confirm the
cash-by-instrument chart stays legible. Check at least one filter
combination that legitimately returns zero rows on each of Expenses/
Depreciation/Shared Costs and confirm `EmptyState` renders, not a blank
table.

- [ ] **Step 5: No commit for this task** — verification only. Fix any bug
  found in the relevant earlier task's files and commit with a `fix:`
  message referencing what broke.

---

## Self-Review Notes

- **Spec coverage:** §3.1 (date-range filter) → Task 1; §3.2 (receivables)
  → Task 2; §3.4 (docs) → Task 3; §4.1 (Expenses filters) → Task 5; §4.2
  (Depreciation filters) → Task 6; §4.3 (Shared Costs tab) → Task 7; §4.4
  (receivables KPI + chart) → Task 8; §4.5 (Batch P&L, no change) —
  explicitly no task, matches spec.
- **Type consistency checked:** `FinanceAsset` (Task 4) is the type Task 6
  imports and uses, not redefined. `outstanding_receivables` field name
  matches between Task 2 (backend), Task 4 (frontend type), and Task 8
  (consumer) verbatim.
- **No placeholders:** every task has concrete code, not "add validation"-
  style prose.
