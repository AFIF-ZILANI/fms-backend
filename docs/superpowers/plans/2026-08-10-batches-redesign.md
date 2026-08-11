# Batches Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gap between `docs/FEATURES.md` §2.2's spec for the Batches
pages and what's actually built — filters/sort/mortality visibility on the
list page, charts on Mortality/Weight, actual-vs-planned on Feeding Program,
and two entirely new tabs (Treatments, Financials) whose backend
dependencies have existed, unused, since earlier work on this project.

**Architecture:** One small, backward-compatible backend change (widening an
already-optional-everywhere-else query param). Everything else is frontend:
new filter/sort UI on the list page following its own existing pattern, two
new charts reusing `web/src/pages/analytics/chart-theme.ts` verbatim, and two
new tabs wired against fully-built backend endpoints (`Doctors`/
`Medications`/`Vaccinations`, `/analytics/batches/:id/pnl`).

**Tech Stack:** Bun, Hono, Prisma, Zod (backend) · React 19, TanStack Query,
Recharts + `chart-theme.ts` (already installed/built), react-hook-form + zod
(frontend forms, unchanged pattern).

**Spec:** `server/docs/batches-redesign-design.md` — read it before starting;
every task below implements one numbered section of it.

## Global Constraints

- No DB schema changes — every gap closes with an existing endpoint, a
  client-side computation over already-fetched data, or one query-param
  widening.
- FCR and bird-days allocation stay out of scope (unit-conversion ambiguity
  and v2-formula gaps respectively) — don't build either even if a task
  seems to brush against them.
- `administered_by_id`/`recorded_by_id`-style fields use the existing
  `ActorSelect` (Admins-only) — do not build a broader "any Profile"
  picker, matches every existing form in this app.
- Colors only through CSS variable tokens, reusing
  `web/src/pages/analytics/chart-theme.ts` — no new hex/oklch literals.
- Money/quantity fields are JSON strings on the wire (Decimal → string) —
  `parseFloat` before charting or arithmetic, same as every prior chart
  task in this project.

---

## Part A — Backend (`server/`)

### Task 1: Widen `/analytics/batches/performance`'s `status` filter

**Files:**
- Modify: `server/src/validators/analytics.validator.ts`
- Modify: `server/src/services/analytics.service.ts`
- Modify: `server/src/services/analytics.service.test.ts`
- Modify: `server/docs/api.md`

**Interfaces:**
- Produces: `batchesPerformanceQuerySchema`'s `status` field becomes
  `z.enum(["RUNNING", "CLOSED", "SOLD"]).optional()` (was `.default("RUNNING")`)
- `AnalyticsService.batchesPerformance(status?: "RUNNING" | "CLOSED" | "SOLD")`
  — parameter becomes optional; omitted means no status filter (all
  batches), not a forced default.

- [ ] **Step 1: Write the failing test**

The existing `beforeAll` fixture seeds one `RUNNING` batch (`batchId`).
Append to `server/src/services/analytics.service.test.ts`, inside the
existing `describe("AnalyticsService", ...)` block:

```ts
    test("batchesPerformance with no status filter includes batches of any status", async () => {
        const rows = await AnalyticsService.batchesPerformance(undefined);
        expect(rows.some((r) => r.batch_id === batchId)).toBe(true);
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && bun test src/services/analytics.service.test.ts -t "no status filter"`
Expected: FAIL — `batchesPerformance` currently requires a
`"RUNNING" | "CLOSED" | "SOLD"` argument, `undefined` is a type error today
(and if forced to compile, the route-level default would still apply
`RUNNING`, not "no filter" — the point of this test is the *service*
function's own behavior with an explicit `undefined`)

- [ ] **Step 3: Update the validator**

In `server/src/validators/analytics.validator.ts`, find
`batchesPerformanceQuerySchema` and change:

```ts
export const batchesPerformanceQuerySchema = z.object({
    status: z.enum(["RUNNING", "CLOSED", "SOLD"]).optional(),
});
```

(Removes `.default("RUNNING")`.)

- [ ] **Step 4: Update the service**

In `server/src/services/analytics.service.ts`, find `batchesPerformance`
and change its signature and the `where` it builds:

```ts
    async batchesPerformance(status?: "RUNNING" | "CLOSED" | "SOLD") {
        const batches = await prisma.batches.findMany({
            where: status !== undefined ? { status } : {},
            include: { houseBalances: true },
        });
```

(Rest of the function body — the mortality/weight aggregation and the
final `.map()` — is unchanged.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && bun test src/services/analytics.service.test.ts -t "no status filter"`
Expected: PASS

- [ ] **Step 6: Run the full analytics test file to confirm no regressions**

Run: `cd server && bun test src/services/analytics.service.test.ts`
Expected: all tests PASS, including the pre-existing
`batchesPerformance('RUNNING') includes this batch...` test (still passes
an explicit `"RUNNING"`, behavior unchanged for that call)

- [ ] **Step 7: Update api.md**

Run: `grep -n "batches/performance" docs/api.md` to find the existing row.
Update its `status?` query param description from "default `RUNNING`" to
"optional, all statuses when omitted."

- [ ] **Step 8: Commit**

```bash
cd server
git add src/validators/analytics.validator.ts src/services/analytics.service.ts src/services/analytics.service.test.ts docs/api.md
git commit -m "feat: make GET /analytics/batches/performance's status filter fully optional"
```

---

## Part B — Frontend (`web/`)

### Task 2: New types for Doctors, Medications, Vaccinations, Consumption

**Files:**
- Modify: `web/src/pages/batches/types.ts`
- Create: `web/src/pages/batches/doctor-types.ts`

**Interfaces:**
- Produces: `Doctor`, `Medication`, `Vaccination`, `Consumption` types —
  consumed by Tasks 6 (Feeding Program), 7 (DoctorSelect), 8 (Treatments)

- [ ] **Step 1: Add Medications/Vaccinations/Consumption types**

Append to `web/src/pages/batches/types.ts`:

```ts
export type Medication = {
  id: string;
  batch_id: string;
  consumption_id: string | null;
  medicine_name: string;
  dosage: string;
  cause: string | null;
  period: string | null;
  administered_by_id: string;
  doctor_id: string | null;
  remarks: string | null;
  date: string;
};

export type Vaccination = {
  id: string;
  batch_id: string;
  consumption_id: string | null;
  vaccine_name: string;
  dosage: number;
  cause: string | null;
  period: string | null;
  administered_by_id: string;
  doctor_id: string | null;
  remarks: string | null;
  date: string;
};

export type Consumption = {
  id: string;
  batch_id: string | null;
  house_id: string;
  item_id: string;
  quantity: string;
  date: string;
};
```

- [ ] **Step 2: Create the Doctor type in its own file**

`Doctor` is used by a shared component (Task 7's `DoctorSelect`, which
lives under `web/src/components/shared/`, not `web/src/pages/batches/`) —
give it its own small file so that component doesn't reach into a page's
types file. Create `web/src/pages/batches/doctor-types.ts`:

```ts
export type Doctor = {
  id: string;
  profile_id: string;
  specialty: string | null;
  position: string | null;
  degrees: string[];
  institution: string | null;
  rating: number | null;
  profile: { id: string; name: string };
};
```

- [ ] **Step 3: Typecheck**

Run: `cd web && bunx tsc -b --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
cd web
git add src/pages/batches/types.ts src/pages/batches/doctor-types.ts
git commit -m "feat: add Doctor/Medication/Vaccination/Consumption types"
```

---

### Task 3: List page — breed/phase filters, sort, mortality column, nearing-selling flag

**Files:**
- Modify: `web/src/pages/batches/batches-list-page.tsx`

**Interfaces:**
- Consumes: `GET /analytics/batches/performance` (optionally without
  `status`, per Task 1), `BatchPerformance` type (existing, from
  `web/src/pages/analytics/types.ts`)

- [ ] **Step 1: Add breed/phase filter state and bulk performance fetch**

Read the current `web/src/pages/batches/batches-list-page.tsx` in full
first (it has an existing `statusFilter` pattern to match exactly). Add:

```ts
import type { BatchPerformance } from "@/pages/analytics/types";
import { BIRD_BREEDS, PHASES, type BirdBreed, type Phase } from "@/pages/batches/types";
```

```ts
  const [breedFilter, setBreedFilter] = useState<BirdBreed | "ALL">("ALL");
  const [phaseFilter, setPhaseFilter] = useState<Phase | "ALL">("ALL");
  const [sortBy, setSortBy] = useState<"starting_date" | "days_running" | "mortality_rate">("starting_date");
```

Update the existing query-building block:

```ts
  const query = new URLSearchParams({ limit: "100" });
  if (statusFilter !== "ALL") query.set("status", statusFilter);
  if (breedFilter !== "ALL") query.set("breed", breedFilter);
  if (phaseFilter !== "ALL") query.set("phase", phaseFilter);
  const { data, isLoading } = useGetData<Paginated<Batch>>(`/batches?${query}`, [
    "batches",
    statusFilter,
    breedFilter,
    phaseFilter,
  ]);

  const performanceQuery = new URLSearchParams();
  if (statusFilter !== "ALL") performanceQuery.set("status", statusFilter);
  const { data: performances } = useGetData<BatchPerformance[]>(
    `/analytics/batches/performance${performanceQuery.toString() ? `?${performanceQuery}` : ""}`,
    ["analytics", "batches-performance", statusFilter],
  );
```

- [ ] **Step 2: Add breed/phase Selects next to the existing status filter**

In the existing filter row (the `<div className="flex items-center justify-between">` containing the status `<Select>` and "Create batch" button), add two more `Select`s before the "Create batch" `Button`, following the exact structure of the existing status `Select`:

```tsx
        <Select value={breedFilter} onValueChange={(v) => setBreedFilter((v ?? "ALL") as BirdBreed | "ALL")}>
          <SelectTrigger className="w-40">
            <SelectValue>{(v: BirdBreed | "ALL" | "") => (v && v !== "ALL" ? humanizeEnum(v) : "All breeds")}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All breeds</SelectItem>
            {BIRD_BREEDS.map((breed) => (
              <SelectItem key={breed} value={breed}>
                {humanizeEnum(breed)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={phaseFilter} onValueChange={(v) => setPhaseFilter((v ?? "ALL") as Phase | "ALL")}>
          <SelectTrigger className="w-36">
            <SelectValue>{(v: Phase | "ALL" | "") => (v && v !== "ALL" ? humanizeEnum(v) : "All phases")}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All phases</SelectItem>
            {PHASES.map((phase) => (
              <SelectItem key={phase} value={phase}>
                {humanizeEnum(phase)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={(v) => setSortBy((v ?? "starting_date") as typeof sortBy)}>
          <SelectTrigger className="w-44">
            <SelectValue>
              {(v: string) =>
                v === "days_running" ? "Sort: Days running" : v === "mortality_rate" ? "Sort: Mortality rate" : "Sort: Starting date"
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="starting_date">Sort: Starting date</SelectItem>
            <SelectItem value="days_running">Sort: Days running</SelectItem>
            <SelectItem value="mortality_rate">Sort: Mortality rate</SelectItem>
          </SelectContent>
        </Select>
```

- [ ] **Step 3: Sort the rows and add the mortality/nearing-selling columns**

Add a helper above the component and a sorted-rows computation inside it:

```ts
function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}
```

```ts
  const performanceByBatch = new Map((performances ?? []).map((p) => [p.batch_id, p]));
  const sortedBatches = [...batches].sort((a, b) => {
    if (sortBy === "days_running") return ageInDays(b.starting_date) - ageInDays(a.starting_date);
    if (sortBy === "mortality_rate") {
      const rateA = performanceByBatch.get(a.id)?.cumulative_mortality_rate ?? 0;
      const rateB = performanceByBatch.get(b.id)?.cumulative_mortality_rate ?? 0;
      return rateB - rateA;
    }
    return new Date(b.starting_date).getTime() - new Date(a.starting_date).getTime();
  });
```

(Use `sortedBatches` instead of `batches` as the `DataTable`'s `rows` prop.)

Add two columns to the existing `columns: Column<Batch>[]` array, after
the existing "status" column:

```ts
    {
      key: "mortality",
      header: "Mortality",
      render: (b) => {
        const rate = performanceByBatch.get(b.id)?.cumulative_mortality_rate;
        if (rate === undefined) return "—";
        const tone = rate > 0.05 ? "critical" : rate > 0.02 ? "warning" : "success";
        return <StatusBadge tone={tone} label={`${(rate * 100).toFixed(1)}%`} />;
      },
      numeric: true,
    },
    {
      key: "selling",
      header: "Selling",
      render: (b) =>
        b.status === "RUNNING" && daysUntil(b.expected_selling_date) <= 7 ? (
          <StatusBadge tone="warning" label={daysUntil(b.expected_selling_date) <= 0 ? "Past due" : "Selling soon"} />
        ) : (
          "—"
        ),
    },
```

(`StatusBadge`/`Tone` is already imported on this page for the existing
status column — reuse it, don't re-import.)

- [ ] **Step 4: Typecheck**

Run: `cd web && bunx tsc -b --noEmit`
Expected: no errors

- [ ] **Step 5: Manual verification**

Run `cd web && bun run dev`, open Batches. Confirm: breed/phase filters
narrow the table independently of status; the sort dropdown reorders rows
correctly for all three options; the mortality column shows a tone-colored
badge matching the same thresholds used elsewhere in this app (>5% =
critical, >2% = warning, else success); a `RUNNING` batch with
`expected_selling_date` within 7 days shows a "Selling soon" (or "Past
due" if already passed) badge, and batches outside that window show "—".

- [ ] **Step 6: Commit**

```bash
cd web
git add src/pages/batches/batches-list-page.tsx
git commit -m "feat: add breed/phase filters, sort, and mortality visibility to Batches list"
```

---

### Task 4: Mortality tab — cumulative mortality chart

**Files:**
- Modify: `web/src/pages/batches/tabs/mortality-tab.tsx`

**Interfaces:**
- Consumes: the same `mortality-logs` fetch already on this tab (no new
  fetch), `chart-theme.ts` exports (existing)

- [ ] **Step 1: Add the cumulative-sum chart above the table**

Read the current `web/src/pages/batches/tabs/mortality-tab.tsx` in full
first. Add imports:

```ts
import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TooltipValueType } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CHART_HEIGHT, chartAxisProps, chartGridProps, chartTooltipContentStyle, SINGLE_SERIES_STROKE } from "@/pages/analytics/chart-theme";
```

Add a cumulative-sum computation inside the component, before the
`return`:

```ts
  const cumulativeSeries = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const log of data?.results ?? []) {
      const key = log.date.slice(0, 10);
      byDate.set(key, (byDate.get(key) ?? 0) + log.count_died);
    }
    const sortedDates = Array.from(byDate.keys()).sort();
    let running = 0;
    return sortedDates.map((date) => {
      running += byDate.get(date)!;
      return { date, cumulative: running };
    });
  }, [data]);
```

Add the chart Card as the first element inside the outer
`<div className="flex flex-col gap-4">`, before the existing "Log
mortality" button row:

```tsx
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cumulative mortality</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <Skeleton style={{ height: CHART_HEIGHT }} className="w-full" />}
          {!isLoading && cumulativeSeries.length === 0 && (
            <p className="text-sm text-muted-foreground">No mortality logged yet.</p>
          )}
          {!isLoading && cumulativeSeries.length > 0 && (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <LineChart data={cumulativeSeries}>
                <CartesianGrid {...chartGridProps} />
                <XAxis dataKey="date" {...chartAxisProps} />
                <YAxis {...chartAxisProps} allowDecimals={false} />
                <Tooltip
                  contentStyle={chartTooltipContentStyle}
                  formatter={(v: TooltipValueType | undefined) => [String(v), "Cumulative died"]}
                />
                <Line type="monotone" dataKey="cumulative" name="Cumulative died" stroke={SINGLE_SERIES_STROKE} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
```

- [ ] **Step 2: Typecheck**

Run: `cd web && bunx tsc -b --noEmit`
Expected: no errors

- [ ] **Step 3: Manual verification**

Run the dev server, open a batch with mortality logs on more than one day.
Confirm the line is monotonically non-decreasing (cumulative), matches the
sum of the table's "Died" column up to each date, and stays legible in
dark mode (reusing the already-fixed `chart-theme.ts` tokens).

- [ ] **Step 4: Commit**

```bash
cd web
git add src/pages/batches/tabs/mortality-tab.tsx
git commit -m "feat: add cumulative mortality chart to batch Mortality tab"
```

---

### Task 5: Weight tab — growth curve chart

**Files:**
- Modify: `web/src/pages/batches/tabs/weight-tab.tsx`

**Interfaces:**
- Consumes: the same `weight-records` fetch already on this tab (no new
  fetch), `chart-theme.ts` exports (existing)

- [ ] **Step 1: Add the growth-curve chart above the table**

Read the current `web/src/pages/batches/tabs/weight-tab.tsx` in full
first. Add imports:

```ts
import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TooltipValueType } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CHART_HEIGHT, chartAxisProps, chartGridProps, chartTooltipContentStyle, SINGLE_SERIES_STROKE } from "@/pages/analytics/chart-theme";
```

Add the series computation before the `return` (sorted ascending by date —
opposite of the table's own descending sort, a growth curve reads left to
right chronologically):

```ts
  const growthSeries = useMemo(
    () =>
      (data?.results ?? [])
        .map((w) => ({ date: w.date.slice(0, 10), weight: parseFloat(w.average_wt_grams) }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    [data],
  );
```

Add the chart Card as the first element inside the outer
`<div className="flex flex-col gap-4">`, before the "Log weight" button
row:

```tsx
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Growth curve</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <Skeleton style={{ height: CHART_HEIGHT }} className="w-full" />}
          {!isLoading && growthSeries.length === 0 && (
            <p className="text-sm text-muted-foreground">No weight samples logged yet.</p>
          )}
          {!isLoading && growthSeries.length > 0 && (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <LineChart data={growthSeries}>
                <CartesianGrid {...chartGridProps} />
                <XAxis dataKey="date" {...chartAxisProps} />
                <YAxis {...chartAxisProps} />
                <Tooltip
                  contentStyle={chartTooltipContentStyle}
                  formatter={(v: TooltipValueType | undefined) => [`${v} g`, "Avg weight"]}
                />
                <Line type="monotone" dataKey="weight" name="Avg weight (g)" stroke={SINGLE_SERIES_STROKE} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
```

- [ ] **Step 2: Typecheck**

Run: `cd web && bunx tsc -b --noEmit`
Expected: no errors

- [ ] **Step 3: Manual verification**

Run the dev server, open a batch with more than one weight sample.
Confirm the line reads left-to-right chronologically (the table below it
still reads newest-first, unchanged), values match the table's "Avg
weight" column, and the chart is legible in dark mode.

- [ ] **Step 4: Commit**

```bash
cd web
git add src/pages/batches/tabs/weight-tab.tsx
git commit -m "feat: add growth curve chart to batch Weight tab"
```

---

### Task 6: Feeding Program tab — actual vs planned consumption

**Files:**
- Modify: `web/src/pages/batches/tabs/feeding-program-tab.tsx`

**Interfaces:**
- Consumes: `Consumption` type (Task 2), `GET /consumptions?batch_id=`
  (existing endpoint)

- [ ] **Step 1: Fetch this batch's consumption records**

Read the current `web/src/pages/batches/tabs/feeding-program-tab.tsx` in
full first. Add the import and fetch:

```ts
import type { Consumption } from "@/pages/batches/types";
```

```ts
  const { data: consumptions } = useGetData<Paginated<Consumption>>(
    `/consumptions?batch_id=${batch.id}&limit=200`,
    ["consumptions", batch.id],
  );
```

- [ ] **Step 2: Compute actual-consumed per program row**

Add a helper function above the component:

```ts
function daysFromStart(startingDate: string, dayOffset: number): Date {
  const d = new Date(startingDate);
  d.setUTCDate(d.getUTCDate() + dayOffset);
  return d;
}
```

Add a computation inside the component, before the `return` (after
`feedItems` is fetched):

```ts
  const actualConsumed = (program: BatchFeedingProgram): number => {
    const windowStart = daysFromStart(batch.starting_date, program.start_day);
    const windowEnd = program.end_day != null ? daysFromStart(batch.starting_date, program.end_day + 1) : new Date();
    return (consumptions?.results ?? [])
      .filter((c) => c.item_id === program.item_id)
      .filter((c) => {
        const d = new Date(c.date);
        return d >= windowStart && d < windowEnd;
      })
      .reduce((sum, c) => sum + parseFloat(c.quantity), 0);
  };
```

- [ ] **Step 3: Add the "Actual consumed" column**

Add one column to the existing `columns: Column<BatchFeedingProgram>[]`
array, between the existing "end" column and the "actions" column:

```ts
    {
      key: "actual",
      header: "Actual consumed",
      render: (p) => {
        const item = feedItems?.results.find((i) => i.id === p.item_id);
        return `${actualConsumed(p).toLocaleString()} ${item ? humanizeEnum(item.unit) : ""}`.trim();
      },
      numeric: true,
    },
```

- [ ] **Step 4: Typecheck**

Run: `cd web && bunx tsc -b --noEmit`
Expected: no errors

- [ ] **Step 5: Manual verification**

Run the dev server, open a batch with both a feeding program row and
matching `Consumption` records for that item within the program's day
range. Confirm "Actual consumed" shows a nonzero total in the item's unit,
and shows `0` (not blank, not an error) for a program row with no matching
consumption yet.

- [ ] **Step 6: Commit**

```bash
cd web
git add src/pages/batches/tabs/feeding-program-tab.tsx
git commit -m "feat: show actual vs planned consumption on Feeding Program tab"
```

---

### Task 7: DoctorSelect shared component

**Files:**
- Create: `web/src/components/shared/doctor-select.tsx`

**Interfaces:**
- Consumes: `Doctor` type (Task 2, `web/src/pages/batches/doctor-types.ts`)
- Produces: `<DoctorSelect id? value onChange invalid? />` — consumed by
  Task 8's Treatments dialogs

- [ ] **Step 1: Create the component**

Mirrors `web/src/components/shared/actor-select.tsx` exactly in structure
(read it first for the exact JSX shape), sourced from `/doctors` instead of
`/admins`, and optional (doctor_id is nullable on both Medications and
Vaccinations, unlike the required `recorded_by_id` pattern `ActorSelect`
serves). Create `web/src/components/shared/doctor-select.tsx`:

```tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGetData, type Paginated } from "@/lib/api";
import type { Doctor } from "@/pages/batches/doctor-types";

type DoctorSelectProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
};

/** Optional doctor_id picker for Medications/Vaccinations entries — mirrors
 * ActorSelect's structure, sourced from Doctors instead of Admins. Value is
 * Doctors.id (not the underlying Profile's id), matching doctor_id's FK. */
export function DoctorSelect({ id, value, onChange }: DoctorSelectProps) {
  const { data } = useGetData<Paginated<Doctor>>("/doctors?limit=100", ["doctors"]);
  const doctors = data?.results ?? [];

  return (
    <Select value={value} onValueChange={(v) => onChange(v ?? "")}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue>{(v: string) => doctors.find((d) => d.id === v)?.profile.name ?? "None"}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {doctors.map((doctor) => (
          <SelectItem key={doctor.id} value={doctor.id}>
            {doctor.profile.name}
            {doctor.specialty ? ` — ${doctor.specialty}` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && bunx tsc -b --noEmit`
Expected: no errors (this component has no consumers yet — this just
confirms it compiles standalone)

- [ ] **Step 3: Commit**

```bash
cd web
git add src/components/shared/doctor-select.tsx
git commit -m "feat: add DoctorSelect shared component"
```

---

### Task 8: New Treatments tab

**Files:**
- Create: `web/src/pages/batches/tabs/treatments-tab.tsx`
- Create: `web/src/pages/batches/tabs/medication-form-dialog.tsx`
- Create: `web/src/pages/batches/tabs/vaccination-form-dialog.tsx`
- Modify: `web/src/pages/batches/batch-detail-page.tsx`

**Interfaces:**
- Consumes: `Medication`/`Vaccination` types (Task 2), `DoctorSelect`
  (Task 7), `ActorSelect` (existing), `GET/POST /medications`,
  `GET/POST /vaccinations` (existing)
- Produces: `<TreatmentsTab batch={batch} />`

- [ ] **Step 1: Create the medication form dialog**

Follow `web/src/pages/batches/tabs/mortality-form-dialog.tsx`'s exact
structure (read it first — form setup, `useEffect` reset-on-open,
`usePostData`, field-error mapping). Create
`web/src/pages/batches/tabs/medication-form-dialog.tsx`:

```tsx
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActorSelect } from "@/components/shared/actor-select";
import { DoctorSelect } from "@/components/shared/doctor-select";
import { usePostData } from "@/lib/api";
import type { Batch, Medication } from "@/pages/batches/types";

const medicationSchema = z.object({
  medicine_name: z.string().min(1, "Medicine name is required"),
  dosage: z.string().min(1, "Dosage is required"),
  cause: z.string().trim().optional(),
  period: z.string().trim().optional(),
  administered_by_id: z.string().min(1, "Select who administered this"),
  doctor_id: z.string().optional(),
  remarks: z.string().trim().optional(),
  date: z.string().min(1, "Date is required"),
});

type MedicationFormInput = z.input<typeof medicationSchema>;
type MedicationFormValues = z.output<typeof medicationSchema>;

function blankMedication(): MedicationFormInput {
  return {
    medicine_name: "",
    dosage: "",
    cause: "",
    period: "",
    administered_by_id: "",
    doctor_id: "",
    remarks: "",
    date: new Date().toISOString().slice(0, 10),
  };
}

type MedicationFormDialogProps = { open: boolean; onOpenChange: (open: boolean) => void; batch: Batch };

export function MedicationFormDialog({ open, onOpenChange, batch }: MedicationFormDialogProps) {
  const {
    control,
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<MedicationFormInput, unknown, MedicationFormValues>({
    resolver: zodResolver(medicationSchema),
    defaultValues: blankMedication(),
  });

  useEffect(() => {
    if (open) reset(blankMedication());
  }, [open, reset]);

  const queryClient = useQueryClient();
  const createMedication = usePostData<Medication, MedicationFormValues & { batch_id: string }>(
    "/medications",
    ["medications", batch.id],
  );

  const onSubmit = (values: MedicationFormValues) => {
    const payload = {
      ...values,
      batch_id: batch.id,
      cause: values.cause || undefined,
      period: values.period || undefined,
      doctor_id: values.doctor_id || undefined,
      remarks: values.remarks || undefined,
    };
    createMedication.mutate(payload, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: ["medications", batch.id] });
        toast.success("Medication logged");
        onOpenChange(false);
      },
      onError: (error) => {
        let hadFieldError = false;
        for (const key of ["medicine_name", "dosage", "administered_by_id", "date"] as const) {
          const message = error.fieldError(key);
          if (message) {
            setError(key, { message });
            hadFieldError = true;
          }
        }
        if (!hadFieldError) toast.error(error.message);
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log medication</DialogTitle>
          <DialogDescription>{batch.batch_code}</DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)}>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="medicine_name">Medicine name</Label>
              <Input id="medicine_name" {...register("medicine_name")} aria-invalid={!!errors.medicine_name} />
              {errors.medicine_name && <p className="text-xs text-destructive">{errors.medicine_name.message}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dosage">Dosage</Label>
              <Input id="dosage" {...register("dosage")} aria-invalid={!!errors.dosage} />
              {errors.dosage && <p className="text-xs text-destructive">{errors.dosage.message}</p>}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="date">Date</Label>
            <Input id="date" type="date" {...register("date")} aria-invalid={!!errors.date} />
            {errors.date && <p className="text-xs text-destructive">{errors.date.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cause">Cause (optional)</Label>
              <Input id="cause" {...register("cause")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="period">Period (optional)</Label>
              <Input id="period" {...register("period")} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="administered_by_id">Administered by</Label>
            <Controller
              control={control}
              name="administered_by_id"
              render={({ field }) => (
                <ActorSelect
                  id="administered_by_id"
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  invalid={!!errors.administered_by_id}
                />
              )}
            />
            {errors.administered_by_id && (
              <p className="text-xs text-destructive">{errors.administered_by_id.message}</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="doctor_id">Doctor (optional)</Label>
            <Controller
              control={control}
              name="doctor_id"
              render={({ field }) => (
                <DoctorSelect id="doctor_id" value={field.value ?? ""} onChange={field.onChange} />
              )}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="remarks">Remarks (optional)</Label>
            <Input id="remarks" {...register("remarks")} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              Log medication
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Create the vaccination form dialog**

Same structure as Step 1, with `vaccine_name` (string) and `dosage`
(number, since `Vaccination.dosage: number` per Task 2's type — unlike
Medication's string dosage) replacing `medicine_name`/`dosage`. Create
`web/src/pages/batches/tabs/vaccination-form-dialog.tsx`:

```tsx
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActorSelect } from "@/components/shared/actor-select";
import { DoctorSelect } from "@/components/shared/doctor-select";
import { usePostData } from "@/lib/api";
import type { Batch, Vaccination } from "@/pages/batches/types";

const vaccinationSchema = z.object({
  vaccine_name: z.string().min(1, "Vaccine name is required"),
  dosage: z.coerce.number().int().positive("Dosage must be positive"),
  cause: z.string().trim().optional(),
  period: z.string().trim().optional(),
  administered_by_id: z.string().min(1, "Select who administered this"),
  doctor_id: z.string().optional(),
  remarks: z.string().trim().optional(),
  date: z.string().min(1, "Date is required"),
});

type VaccinationFormInput = z.input<typeof vaccinationSchema>;
type VaccinationFormValues = z.output<typeof vaccinationSchema>;

function blankVaccination(): VaccinationFormInput {
  return {
    vaccine_name: "",
    dosage: undefined,
    cause: "",
    period: "",
    administered_by_id: "",
    doctor_id: "",
    remarks: "",
    date: new Date().toISOString().slice(0, 10),
  };
}

type VaccinationFormDialogProps = { open: boolean; onOpenChange: (open: boolean) => void; batch: Batch };

export function VaccinationFormDialog({ open, onOpenChange, batch }: VaccinationFormDialogProps) {
  const {
    control,
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<VaccinationFormInput, unknown, VaccinationFormValues>({
    resolver: zodResolver(vaccinationSchema),
    defaultValues: blankVaccination(),
  });

  useEffect(() => {
    if (open) reset(blankVaccination());
  }, [open, reset]);

  const queryClient = useQueryClient();
  const createVaccination = usePostData<Vaccination, VaccinationFormValues & { batch_id: string }>(
    "/vaccinations",
    ["vaccinations", batch.id],
  );

  const onSubmit = (values: VaccinationFormValues) => {
    const payload = {
      ...values,
      batch_id: batch.id,
      cause: values.cause || undefined,
      period: values.period || undefined,
      doctor_id: values.doctor_id || undefined,
      remarks: values.remarks || undefined,
    };
    createVaccination.mutate(payload, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: ["vaccinations", batch.id] });
        toast.success("Vaccination logged");
        onOpenChange(false);
      },
      onError: (error) => {
        let hadFieldError = false;
        for (const key of ["vaccine_name", "dosage", "administered_by_id", "date"] as const) {
          const message = error.fieldError(key);
          if (message) {
            setError(key, { message });
            hadFieldError = true;
          }
        }
        if (!hadFieldError) toast.error(error.message);
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log vaccination</DialogTitle>
          <DialogDescription>{batch.batch_code}</DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)}>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="vaccine_name">Vaccine name</Label>
              <Input id="vaccine_name" {...register("vaccine_name")} aria-invalid={!!errors.vaccine_name} />
              {errors.vaccine_name && <p className="text-xs text-destructive">{errors.vaccine_name.message}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dosage">Dosage</Label>
              <Input id="dosage" type="number" {...register("dosage")} aria-invalid={!!errors.dosage} />
              {errors.dosage && <p className="text-xs text-destructive">{errors.dosage.message}</p>}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="date">Date</Label>
            <Input id="date" type="date" {...register("date")} aria-invalid={!!errors.date} />
            {errors.date && <p className="text-xs text-destructive">{errors.date.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cause">Cause (optional)</Label>
              <Input id="cause" {...register("cause")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="period">Period (optional)</Label>
              <Input id="period" {...register("period")} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="administered_by_id">Administered by</Label>
            <Controller
              control={control}
              name="administered_by_id"
              render={({ field }) => (
                <ActorSelect
                  id="administered_by_id"
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  invalid={!!errors.administered_by_id}
                />
              )}
            />
            {errors.administered_by_id && (
              <p className="text-xs text-destructive">{errors.administered_by_id.message}</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="doctor_id">Doctor (optional)</Label>
            <Controller
              control={control}
              name="doctor_id"
              render={({ field }) => (
                <DoctorSelect id="doctor_id" value={field.value ?? ""} onChange={field.onChange} />
              )}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="remarks">Remarks (optional)</Label>
            <Input id="remarks" {...register("remarks")} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              Log vaccination
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Create the Treatments tab**

Create `web/src/pages/batches/tabs/treatments-tab.tsx`:

```tsx
import { useState } from "react";
import { Plus, Syringe, Pill } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/shared/data-table";
import { useGetData, type Paginated } from "@/lib/api";
import type { Batch, Medication, Vaccination } from "@/pages/batches/types";
import { MedicationFormDialog } from "@/pages/batches/tabs/medication-form-dialog";
import { VaccinationFormDialog } from "@/pages/batches/tabs/vaccination-form-dialog";

export function TreatmentsTab({ batch }: { batch: Batch }) {
  const [medicationOpen, setMedicationOpen] = useState(false);
  const [vaccinationOpen, setVaccinationOpen] = useState(false);

  const { data: medications, isLoading: medicationsLoading } = useGetData<Paginated<Medication>>(
    `/medications?batch_id=${batch.id}&limit=100`,
    ["medications", batch.id],
  );
  const { data: vaccinations, isLoading: vaccinationsLoading } = useGetData<Paginated<Vaccination>>(
    `/vaccinations?batch_id=${batch.id}&limit=100`,
    ["vaccinations", batch.id],
  );

  const medicationColumns: Column<Medication>[] = [
    { key: "date", header: "Date", render: (m) => new Date(m.date).toLocaleDateString() },
    { key: "medicine", header: "Medicine", render: (m) => m.medicine_name },
    { key: "dosage", header: "Dosage", render: (m) => m.dosage },
    { key: "cause", header: "Cause", render: (m) => m.cause ?? "—" },
    { key: "remarks", header: "Remarks", render: (m) => m.remarks ?? "—" },
  ];

  const vaccinationColumns: Column<Vaccination>[] = [
    { key: "date", header: "Date", render: (v) => new Date(v.date).toLocaleDateString() },
    { key: "vaccine", header: "Vaccine", render: (v) => v.vaccine_name },
    { key: "dosage", header: "Dosage", render: (v) => v.dosage, numeric: true },
    { key: "cause", header: "Cause", render: (v) => v.cause ?? "—" },
    { key: "remarks", header: "Remarks", render: (v) => v.remarks ?? "—" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Medications</CardTitle>
          <Button size="sm" onClick={() => setMedicationOpen(true)}>
            <Plus />
            Log medication
          </Button>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={medicationColumns}
            rows={medications?.results ?? []}
            rowKey={(m) => m.id}
            isLoading={medicationsLoading}
            empty={{ icon: Pill, title: "No medications logged for this batch" }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Vaccinations</CardTitle>
          <Button size="sm" onClick={() => setVaccinationOpen(true)}>
            <Plus />
            Log vaccination
          </Button>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={vaccinationColumns}
            rows={vaccinations?.results ?? []}
            rowKey={(v) => v.id}
            isLoading={vaccinationsLoading}
            empty={{ icon: Syringe, title: "No vaccinations logged for this batch" }}
          />
        </CardContent>
      </Card>

      <MedicationFormDialog open={medicationOpen} onOpenChange={setMedicationOpen} batch={batch} />
      <VaccinationFormDialog open={vaccinationOpen} onOpenChange={setVaccinationOpen} batch={batch} />
    </div>
  );
}
```

- [ ] **Step 4: Wire the 7th tab into the detail page**

In `web/src/pages/batches/batch-detail-page.tsx`, add the import:

```ts
import { TreatmentsTab } from "@/pages/batches/tabs/treatments-tab";
```

Add a `TabsTrigger`/`TabsContent` pair after "feeding" and before
"environment":

```tsx
          <TabsTrigger value="treatments">Treatments</TabsTrigger>
```

```tsx
        <TabsContent value="treatments">
          <TreatmentsTab batch={batch} />
        </TabsContent>
```

(Insert both immediately after the existing `feeding`
`TabsTrigger`/`TabsContent` pair, before the `environment` pair.)

- [ ] **Step 5: Typecheck**

Run: `cd web && bunx tsc -b --noEmit`
Expected: no errors

- [ ] **Step 6: Manual verification**

Run the dev server, open a batch, click the new "Treatments" tab (should
appear between Feeding Program and Environment). Confirm both empty states
render correctly with no data, then log one medication and one
vaccination and confirm both appear in their respective tables with the
doctor picker correctly optional (submitting with no doctor selected
should succeed).

- [ ] **Step 7: Commit**

```bash
cd web
git add src/pages/batches/tabs/treatments-tab.tsx src/pages/batches/tabs/medication-form-dialog.tsx src/pages/batches/tabs/vaccination-form-dialog.tsx src/pages/batches/batch-detail-page.tsx
git commit -m "feat: add Treatments tab (Medications + Vaccinations) to batch detail"
```

---

### Task 9: New Financials tab

**Files:**
- Create: `web/src/pages/batches/tabs/financials-tab.tsx`
- Modify: `web/src/pages/batches/batch-detail-page.tsx`

**Interfaces:**
- Consumes: `GET /analytics/batches/:id/pnl` (existing), `BatchPnl` type
  (existing, `web/src/pages/finance/types.ts`)
- Produces: `<FinancialsTab batch={batch} />`

- [ ] **Step 1: Create the tab**

Mirrors `web/src/pages/finance/batch-pnl-tab.tsx`'s card layout exactly
(read it first) but without that tab's batch-picker `Select` — this page
already knows which batch. Create
`web/src/pages/batches/tabs/financials-tab.tsx`:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetData } from "@/lib/api";
import { formatMoney } from "@/lib/utils";
import type { Batch } from "@/pages/batches/types";
import type { BatchPnl } from "@/pages/finance/types";

export function FinancialsTab({ batch }: { batch: Batch }) {
  const { data: pnl, isLoading } = useGetData<BatchPnl>(`/analytics/batches/${batch.id}/pnl`, [
    "analytics",
    "pnl",
    batch.id,
  ]);

  if (isLoading || !pnl) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Revenue (bird sales)</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{formatMoney(pnl.revenue)}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Purchase cost (chicks)</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{formatMoney(pnl.purchase_cost)}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Direct expenses</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{formatMoney(pnl.direct_expenses)}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Depreciation share</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{formatMoney(pnl.depreciation_share)}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Shared costs (unallocated)</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums text-muted-foreground">
            {formatMoney(pnl.shared_period_expenses_unallocated)}
          </CardContent>
        </Card>
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Profit</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{formatMoney(pnl.profit)}</CardContent>
        </Card>
      </div>

      {parseFloat(pnl.shared_period_expenses_unallocated) > 0 && (
        <p className="text-xs text-muted-foreground">
          Shared-period costs aren't factored into profit — the bird-days allocation formula that would distribute
          them across concurrent batches is v2, not built yet.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire the 8th (last) tab into the detail page**

In `web/src/pages/batches/batch-detail-page.tsx`, add the import:

```ts
import { FinancialsTab } from "@/pages/batches/tabs/financials-tab";
```

Add a `TabsTrigger`/`TabsContent` pair as the LAST tab, after
"environment":

```tsx
          <TabsTrigger value="financials">Financials</TabsTrigger>
```

```tsx
        <TabsContent value="financials">
          <FinancialsTab batch={batch} />
        </TabsContent>
```

Also update the file's top-of-file ponytail comment (currently explains
why Treatments and Financials aren't built) — both are now built, delete
the comment or replace with a one-line pointer:
`// See docs/batches-redesign-design.md for the full page design.`

- [ ] **Step 3: Typecheck**

Run: `cd web && bunx tsc -b --noEmit`
Expected: no errors

- [ ] **Step 4: Manual verification**

Run the dev server, open a batch with at least one bird sale or expense,
click the new "Financials" tab (last, after Environment). Confirm the
numbers match what the same batch shows on Finance → Batch P&L (pick the
same batch there) — both read the same endpoint, so they must agree.

- [ ] **Step 5: Commit**

```bash
cd web
git add src/pages/batches/tabs/financials-tab.tsx src/pages/batches/batch-detail-page.tsx
git commit -m "feat: add Financials tab to batch detail"
```

---

### Task 10: Overview tab enhancement

**Files:**
- Modify: `web/src/pages/batches/tabs/overview-tab.tsx`

**Interfaces:**
- Consumes: `WeightRecord` type (existing), `GET /weight-records?batch_id=`
  (existing endpoint, new consumer on this tab)

- [ ] **Step 1: Fetch weight records and compute the two new values**

Read the current `web/src/pages/batches/tabs/overview-tab.tsx` in full
first. Add the import and fetch:

```ts
import type { WeightRecord } from "@/pages/batches/types";
```

```ts
  const { data: weightRecords } = useGetData<Paginated<WeightRecord>>(
    `/weight-records?batch_id=${batch.id}&limit=100`,
    ["weight-records", batch.id],
  );
```

Add computations before the `return`:

```ts
  const daysToSelling = Math.ceil(
    (new Date(batch.expected_selling_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );
  const latestWeight = (weightRecords?.results ?? [])
    .slice()
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
```

- [ ] **Step 2: Add two more KPI cards**

Add the `TrendingUp`/`Calendar` icons to the existing `lucide-react`
import line, then add two `KPICard`s to the existing
`grid grid-cols-2 gap-4 lg:grid-cols-4` row (expand it to
`lg:grid-cols-6` to fit six cards on wide screens without wrapping
oddly — the existing four stay `grid-cols-2` on narrow viewports either
way):

```tsx
        <KPICard
          label={batch.status === "RUNNING" && daysToSelling < 0 ? "Past expected selling" : "Days to selling"}
          value={batch.status === "RUNNING" ? Math.abs(daysToSelling) : "—"}
          icon={Calendar}
        />
        <KPICard
          label="Latest avg weight"
          value={latestWeight ? `${latestWeight.average_wt_grams} g` : "—"}
          icon={TrendingUp}
        />
```

(Change the row's className from `grid-cols-2 gap-4 lg:grid-cols-4` to
`grid-cols-2 gap-4 lg:grid-cols-6`.)

- [ ] **Step 3: Typecheck**

Run: `cd web && bunx tsc -b --noEmit`
Expected: no errors

- [ ] **Step 4: Manual verification**

Run the dev server, open a batch's Overview tab. Confirm "Days to
selling" shows a sensible number for a `RUNNING` batch (and "Past
expected selling" styling/label if the date has already passed), and
"Latest avg weight" matches the most recent row on the Weight tab (or "—"
if no weight has been logged yet).

- [ ] **Step 5: Commit**

```bash
cd web
git add src/pages/batches/tabs/overview-tab.tsx
git commit -m "feat: add selling countdown and latest weight to batch Overview tab"
```

---

### Task 11: Full Batches page verification pass

**Files:** none (verification only)

- [ ] **Step 1: Backend tests**

Run: `cd server && bun test`
Expected: all tests PASS (there's one known pre-existing flaky test,
`AlertService > scan raises a negative-performance-pattern alert for a bad
month`, unrelated to this work — if it fails, rerun once to confirm it's
the known flake before treating anything as broken)

- [ ] **Step 2: Frontend build**

Run: `cd web && bun run build`
Expected: no TypeScript errors, build succeeds

- [ ] **Step 3: Live walkthrough — list page**

Start both dev servers (check if already running on 5085/5173 first).
Open Batches. Confirm: status/breed/phase filters each narrow the table
independently; all three sort options reorder correctly; the mortality
column and "selling soon"/"past due" flags render correctly against real
data; "Create batch" still works unchanged.

- [ ] **Step 4: Live walkthrough — detail page, all 8 tabs**

Open a batch with reasonably rich data (mortality logs across multiple
days, more than one weight sample, a feeding program row with matching
consumption, at least one bird sale or expense). Walk all 8 tabs in
order: Overview (6 KPI cards including the two new ones) → House
Allocations (unchanged) → Mortality (chart + table agree) → Weight (chart
+ table agree) → Feeding Program (actual-vs-planned column populated) →
Treatments (both sub-tables, both dialogs work, doctor optional) →
Environment (unchanged) → Financials (numbers match Finance → Batch P&L
for the same batch).

- [ ] **Step 5: Dark mode + empty states**

Switch to dark mode (force the `dark` class on `<html>` — no in-app
toggle exists, per findings from prior work on this project). Confirm
both new charts (Mortality, Weight) stay legible. Open a batch with no
mortality/weight data yet (or a freshly created one) and confirm both
chart cards show their empty-state message, not a blank chart area.

- [ ] **Step 6: No commit for this task** — verification only. Fix any bug
  found in the relevant earlier task's files and commit with a `fix:`
  message referencing what broke.

---

## Self-Review Notes

- **Spec coverage:** §3.1 (optional status filter) → Task 1; §4.1 (list
  filters/sort/mortality/flag) → Task 3; §4.2 (Mortality chart) → Task 4;
  §4.3 (Weight chart) → Task 5; §4.4 (Feeding Program actual-vs-planned) →
  Task 6; §4.5 (Treatments tab + DoctorSelect) → Tasks 7-8; §4.6
  (Financials tab) → Task 9; §4.7 (Overview enhancement) → Task 10. Types
  needed across multiple tasks centralized in Task 2, dispatched before any
  task that needs them.
- **Type consistency checked:** `Doctor`/`Medication`/`Vaccination`/
  `Consumption` (Task 2) are the exact types Tasks 6-8 import, not
  redefined. `DoctorSelect`'s props (Task 7) match exactly how Task 8's two
  dialogs call it. `BatchPnl` (existing Finance type) reused verbatim by
  Task 9, not redefined.
- **No placeholders:** every task has concrete, complete code — no "add
  validation" or "handle edge cases" prose without the actual handling
  shown.
