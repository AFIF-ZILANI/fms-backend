# Batches page redesign — design spec

Date: 2026-08-10
Status: approved, ready for implementation plan

## 1. Problem

The Batches list page and 6-tab batch detail page (`web/src/pages/batches/`)
implement roughly half of `docs/FEATURES.md` §2.2 despite every backend
dependency they need already existing:

1. **Two tabs were scoped but never built.** A code comment on
   `batch-detail-page.tsx` explains why: "Treatments (needs a Doctor picker)
   and Financials (needs Purchases/Sales/Expenses, none built yet) are the
   only two tabs left out." Both conditions are now false — `Doctors`/
   `Medications`/`Vaccinations` have full CRUD endpoints already, and the
   per-batch P&L endpoint (`GET /analytics/batches/:id/pnl`) was built during
   the Analytics dashboard work and has sat unused since.
2. **Mortality and Weight tabs are entry-only.** FEATURES.md explicitly
   calls for a "cumulative mortality chart" (Mortality tab) and a "growth
   curve" (Weight tab); both tabs currently render a form button and a table,
   nothing else.
3. **Feeding Program tab shows the plan, never the reality.** FEATURES.md
   wants "actual vs. planned consumption"; the tab only lists the defined
   program rows.
4. **The list page can't answer the two questions a farm manager checks
   first**: which batches are losing birds fastest, and which are close to
   market weight. Filtering is status-only (breed/phase are already
   supported server-side, unexposed in the UI), there's no sort, and
   mortality rate isn't visible without opening every batch individually.

## 2. Scope

**In scope**: filters + sort + mortality visibility on the list page;
mortality/weight charts, actual-vs-planned feeding comparison, and two new
tabs (Treatments, Financials) on the detail page; one small backward-
compatible backend change.

**Out of scope** (deliberate, not oversight):
- **FCR (feed conversion ratio)** — still blocked on the same unit-
  conversion ambiguity flagged since the original schema analysis: feed is
  logged in whatever `Unit` the item uses, and converting that to a true
  ratio needs a per-unit weight table this system doesn't have.
- **Bird-days shared-cost allocation** — still v2 per
  `system-design-arc.md` §7, needs 2-3 batches of real overlapping data to
  validate a formula against. Untouched here, same as Analytics and
  Finance.
- **A broader "any Profile" picker for `administered_by_id`.** The schema
  comment on `Medications`/`Vaccinations` notes this field accepts any
  Profile, not just Admins — but every existing form in this app
  (`recorded_by_id`, `measured_by_id`, etc.) already narrows this to
  `ActorSelect` (Admins-only), matching the "single admin user for v1"
  convention noted as an open item in `system-design-arc.md` §7. The new
  Treatments tab follows this same established precedent rather than
  inventing a broader picker pattern for one form.
- **DB schema changes** — none needed. Every gap closes with existing
  tables/endpoints or one query-param widening.

## 3. Backend

### 3.1 Widen `/analytics/batches/performance`'s `status` filter

`batchesPerformanceQuerySchema` (`server/src/validators/analytics.validator.ts`)
currently forces `status` to default to `"RUNNING"` when omitted. The list
page needs mortality-rate data across whatever statuses the user is
currently filtering to (including "all statuses" — no filter at all), not
just running batches.

Change `status: z.enum(["RUNNING", "CLOSED", "SOLD"]).default("RUNNING")`
to `status: z.enum(["RUNNING", "CLOSED", "SOLD"]).optional()`, and in
`AnalyticsService.batchesPerformance`, only apply the `where: { status }`
filter when `status` is defined — omitted means all statuses, not a forced
default.

**Backward compatible**: the only existing caller
(`web/src/pages/analytics/analytics-page.tsx`) always passes
`?status=RUNNING` explicitly, so no consumer's behavior changes.

### 3.2 Everything else already exists

No other backend work. `GET /batches` already supports `breed`/`phase`
filters. `GET /medications?batch_id=`, `GET /vaccinations?batch_id=`,
`GET /doctors` are fully built. `GET /analytics/batches/:id/pnl` is fully
built. `GET /consumptions?batch_id=` (for actual-vs-planned feeding) is
fully built. `GET /mortality-logs?batch_id=` and
`GET /weight-records?batch_id=` (for the new charts) are fully built.

### 3.3 Docs

`server/docs/api.md`'s `GET /analytics/batches/performance` row gets its
`status?` query param documentation updated to note it's now fully
optional (all statuses when omitted) rather than defaulting to RUNNING.

## 4. Frontend

### 4.1 Batches list page (`web/src/pages/batches/batches-list-page.tsx`)

- **Breed and phase filters**: two more `Select`s next to the existing
  status filter, same pattern (`useState` → conditional `URLSearchParams`
  param, matches the app-wide convention this page already established).
- **Sort control**: a `Select` — "Starting date" (default, matches current
  `orderBy: created_at desc` behavior closely enough), "Days running",
  "Mortality rate". Sorting happens client-side over the fetched page (this
  page already fetches `limit=100` in one call — no backend sort param
  needed, matches the "client work over fetched data" pattern used
  throughout this app at this data scale).
- **Mortality rate column**: new column in the table, sourced from one bulk
  fetch to `/analytics/batches/performance` (no `status` param when the
  list's own status filter is "All", otherwise pass the selected status
  through) — not a per-row fetch. Batches with no matching performance row
  (shouldn't happen once §3.1 ships, but defensively) show "—".
- **Nearing-selling-date flag**: for `RUNNING` batches where
  `expected_selling_date` is within 7 days, render a `warning`-tone
  `StatusBadge` inline next to the status badge (e.g. "Selling soon").
  Client-side date math, no new data.

### 4.2 Batch detail page — Mortality tab

Add a cumulative mortality line chart above the existing table, using the
already-fetched `mortality-logs` list for this batch (no new fetch): bucket
by calendar day, running cumulative sum of `count_died`, single-series line
chart reusing `web/src/pages/analytics/chart-theme.ts` (`CHART_HEIGHT`,
`chartAxisProps`, `chartGridProps`, `chartTooltipContentStyle`,
`SINGLE_SERIES_STROKE`) — same tokens, same visual language as every chart
built for Analytics and Finance, not a new pattern.

### 4.3 Batch detail page — Weight tab

Add a growth curve line chart above the existing table, using the
already-fetched `weight-records` list for this batch: one point per
recorded `(date, average_wt_grams)`, same chart-theme tokens as above.

### 4.4 Batch detail page — Feeding Program tab

For each program row (`feed_type`, `item_id`, `start_day`, `end_day`),
compute the actual quantity consumed: filter this batch's
`GET /consumptions?batch_id=` results to `item_id` matching the program
row and `date` falling within
`[batch.starting_date + start_day days, batch.starting_date + (end_day ??
now) days]`, sum `quantity`. Add an "Actual consumed" column next to the
existing plan columns — same `Item.unit` the consumption rows already
carry, no unit conversion attempted (matches the FCR-avoidance reasoning
elsewhere in this codebase).

### 4.5 Batch detail page — new Treatments tab

New 7th tab, positioned after Feeding Program and before Environment
(matches the day-to-day operational tab grouping FEATURES.md lists them
in). Two sections on one tab (not two separate tabs — Medications and
Vaccinations are the same shape of data, both already have a combined
"Treatments" heading in the spec):

- Medications history table (date, medicine name, dosage, cause,
  administered by, doctor, remarks) + "Log medication" dialog.
- Vaccinations history table (date, vaccine name, dosage, cause,
  administered by, doctor, remarks) + "Log vaccination" dialog.
- Both dialogs use the existing `ActorSelect` for `administered_by_id`
  (matches every other form in this app) and a new `DoctorSelect`
  component (`web/src/components/shared/doctor-select.tsx`) for the
  optional `doctor_id`, mirroring `ActorSelect`'s exact structure but
  sourced from `GET /doctors?limit=100`.

### 4.6 Batch detail page — new Financials tab

New 8th tab (last), surfacing `GET /analytics/batches/:id/pnl` — the exact
same `BatchPnl` shape and card layout `web/src/pages/finance/batch-pnl-tab.tsx`
already renders for a user-selected batch, just pre-scoped to this batch (no
batch picker needed, the page already knows which batch). Read-only, no
new form — matches the read-only nature of the existing Finance tab this
mirrors.

### 4.7 Batch detail page — Overview tab enhancement

Two additions to the existing 4-KPI-card row:
- Days until expected selling date (or "Past due" styling if `RUNNING` and
  the date has passed) — client-side date math against the already-loaded
  `batch.expected_selling_date`.
- Latest average weight reading — fetch the same `weight-records` data
  already used by §4.3's chart (share the query, don't duplicate the
  fetch), take the most recent by date.

## 5. Testing

- Backend: extend `analytics.service.test.ts`'s existing
  `batchesPerformance` test coverage with a case asserting the optional
  `status` param (omitted → batches of multiple statuses returned, not
  just RUNNING).
- Frontend: no existing test layer for pages in this repo (consistent with
  every prior page in this project) — verified manually via dev server,
  as established in the Analytics and Finance work.

## 6. Open items

None — all decisions above were confirmed with the user during
brainstorming (feature list and scope approved as written).
