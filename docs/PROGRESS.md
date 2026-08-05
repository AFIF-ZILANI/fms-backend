# FMS API — Implementation Progress

Tracks build order and status against `docs/FEATURES.md`. One phase = one
branch = one merge to `main` (per the mandatory branch workflow). Update the
status marker as work moves — this file is the persistent memory of where
the build is, read it first when resuming.

Status key: `⬜ not started` · `🔨 in progress` · `✅ done` · `⛔ blocked`

| #   | Phase                                   | Models                                                                                                                  | Depends on          | Status                                                                                                                            |
| --- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Foundation                              | DB, env, drop stale `user.*` scaffold                                                                                   | —                   | ✅                                                                                                                                |
| 1   | **Admins**                              | `Profiles` (role=ADMIN), `Admins`                                                                                       | 0                   | ✅                                                                                                                                |
| 2   | Employees                               | `Profiles` (role=EMPLOYEE), `Employees`                                                                                 | 0                   | ✅                                                                                                                                |
| 3   | Suppliers / Customers / Doctors         | `Suppliers`, `Customers`, `Doctors`                                                                                     | 0                   | ✅                                                                                                                                |
| 4   | Houses                                  | `Houses`                                                                                                                | 0                   | ✅                                                                                                                                |
| 5   | Inventory                               | `Item`, `Warehouses`, `Organization`/`ItemOrganization`, `StockUnit`, `Asset`, `StockLedger`\*, `InventoryAdjustment`\* | 0                   | ✅                                                                                                                                |
| 6   | Batches                                 | `Batches`, `BatchHouseAllocation`, `BatchHouseBalance`, `MortalityLog`                                                  | 4                   | ✅                                                                                                                                |
| 7   | Purchases                               | `Purchase`, `PurchaseItem`                                                                                              | 3, 5, 6             | ✅                                                                                                                                |
| 8   | Treatment & Monitoring                  | `Medications`, `Vaccinations`, `EnvironmentRecords`, `WeightRecords`, `BatchFeedingProgram`, `Consumption`              | 5, 6                | ✅                                                                                                                                |
| 9   | Sales                                   | `Sale`, `SaleItem`, `BirdSale`                                                                                          | 3, 5, 6             | ✅                                                                                                                                |
| 10  | Payments                                | `Payment`, `PaymentInstrument`                                                                                          | 7, 9                | ✅                                                                                                                                |
| 11  | Finance                                 | `Expense`, `AssetDepreciation` (batch-close trigger)                                                                    | 5, 6                | ✅                                                                                                                                |
| 12  | Payroll                                 | `PerformanceScoreEntry`, `PayrollRecord`                                                                                | 2                   | ✅                                                                                                                                |
| 13  | Alerts                                  | `Alerts` (+ trigger rules)                                                                                              | 1–12 (reads across) | ✅                                                                                                                                |
| 14  | Audit Log (read API + write middleware) | `AuditLog`                                                                                                              | 15                  | ⬜                                                                                                                                |
| 15  | Auth & permission enforcement           | —                                                                                                                       | 1, 2                | ⛔ blocked — no credential scheme decided yet (schema has no password/OTP field); needs its own design pass before implementation |
| 16  | Analytics                               | reads everything                                                                                                        | 1–14                | ⬜                                                                                                                                |

\* `StockLedger`/`InventoryAdjustment` were missed from Phase 5's original
scope in this table — caught and closed at the start of Phase 8, since
`Consumption` needs `StockLedger` for non-coded (feed) draws. See the Phase
8 entry below.

## Current step

**Phase 5 (Inventory) — done.** Branch `feat/inventory-api`, ready to merge.
Biggest phase so far — 6 resources across 5 models.

- [x] `Item`: catalog CRUD + deactivate/reactivate, `normalized_key`
      computed server-side (never trust client input for the dedup key),
      optional m2m link to `Suppliers`.
- [x] `Warehouses`: create + rename only, deliberately no delete/deactivate
      (`InventoryAdjustment` cascades on delete, so removing one would
      silently destroy adjustment history; it's rare enough not to need a
      lifecycle at all — YAGNI over building a flag nothing uses yet).
- [x] `Organization` + `ItemOrganization`: recall-tracing links
      (manufacturer/importer/marketer/distributor per item), same
      server-computed `normalized_key` pattern as Item.
- [x] `StockUnit`: the QR-code-per-unit lifecycle from
      `inventory-tracking-design.md` — provision (blank codes,
      `UNASSIGNED`), bind to a purchase lot (`→ IN_STOCK`), relocate,
      dispose. Deliberately did **not** build the `IN_USE`/`CONSUMED`
      transitions here — those belong to Consumption's business logic in
      Phase 8, not Inventory's.
      **Dependency note**: `bind()` needs a real `PurchaseItem`
      (Phase 7, not built yet). Built the endpoint now anyway since
      provisioning/relocate/dispose don't need it; the test seeds a
      `PurchaseItem` directly via Prisma (bypassing the not-yet-built
      Purchases API) to exercise `bind()` — a legitimate fixture pattern
      for an out-of-order dependency, not a shortcut around real behavior.
- [x] `Asset`: create (1:1 with a `StockUnit`) + status transitions.
      `AssetDepreciation` stays out of scope here — it's Phase 11
      (Finance), triggered at batch close.
- [x] **Real bug found and fixed**: binding a `StockUnit` to a nonexistent
      `purchase_item_id` returned a raw 500 (unhandled Postgres FK
      violation, P2003) instead of a clean error. This isn't
      StockUnit-specific — any create/update taking a client-supplied
      foreign id can hit it (`Item.supplier_ids`, `ItemOrganization`'s
      `item_id`/`organization_id`, `Asset.stock_unit_id`, and every
      `recorded_by_id`-style field in every phase from here on). Renamed
      `handleUniqueConstraint` → `handlePrismaWriteError` and extended it
      to map P2003 → 400 alongside P2002 → 409, applied everywhere it was
      already used plus `StockUnit.bind`/`relocate`. Confirmed the actual
      `meta` shape from `@prisma/adapter-pg` directly (nested at
      `meta.driverAdapterError.cause.constraint.index`) rather than
      guessing — it doesn't match the classic engine's shape, same lesson
      as the P2002 fix in Phase 3.
- [x] 63 tests passing (across 11 files)
- [x] Dev server smoke-tested end to end, including the FK-violation fix
- [ ] Merged to `main`

**Working convention for actor fields, since there's no auth yet (Phase
15 blocked)**: optional actor fields (`StockUnit.bound_by_id`) are accepted
as an optional field in the request body. Required actor fields
(`recorded_by_id`) are accepted as a required client-supplied field in the
request body, until Phase 15 replaces it with a real session. Used this
convention for the first time in Phase 6 (`Batches.create`,
`BatchHouseAllocation.create`, `MortalityLog.create` all take
`recorded_by_id` directly).

**Phase 6 (Batches) — done.** Branch `feat/batches-api`, ready to merge.
Biggest module yet for correctness risk, even though it's fewer resources
than Phase 5 — this is where money-adjacent balance math lives.

- [x] `Batches`: create wraps the Batch + INITIAL `BatchHouseAllocation` +
      starting `BatchHouseBalance` in one transaction (the "chicks arrive"
      flow from `system-design-arc.md` §4). Update is blocked once a batch
      leaves `RUNNING`. Close is the confirmed manual-admin-action design
      (FEATURES.md §2.2): requires the batch's balances to sum to zero,
      with a `force:true` escape hatch since `BirdSale` (Phase 9) doesn't
      exist yet to reconcile sold birds against. `AssetDepreciation`
      computation stays out of scope — Phase 11.
- [x] `BatchHouseAllocation`: one algorithm covers `TRANSFER` and
      `ADJUSTMENT` — decrement `from_house_id`'s balance if set, increment
      `to_house_id`'s if set (matches the schema comment: quantity is
      always positive, direction is whichever field is set). Rejects a
      transfer that would take a house negative. Rejects any allocation on
      a non-`RUNNING` batch.
- [x] `MortalityLog`: decrements the batch-house balance in the same
      transaction as the log row — one of only three things allowed to
      touch that balance (the schema's own words). Rejects a mortality
      count that exceeds the house's live balance.
- [x] `BatchHouseBalance`: read-only list endpoint (filterable by
      batch/house) for the occupancy-grid style views `FEATURES.md`
      describes.
- [x] Explicitly verified transactional rollback in tests, not just the
      happy path: an over-quantity transfer or over-count mortality log
      leaves the balance untouched and writes zero rows — confirmed by
      querying the DB directly after the rejected call, not just asserting
      on the thrown error.
- [x] 16 new tests (78 total). Full lifecycle also smoke-tested over real
      HTTP: create → transfer → mortality → close-without-force (rejected
      with the exact remaining count) → close-with-force.
- [ ] Merged to `main`

**Phase 7 (Purchases) — done.** Branch `feat/purchases-api`, ready to merge.

- [x] `Purchase` + `PurchaseItem`: create only, no update -- both are
      explicitly append-only per `system-design-arc.md` §6 ("a correction
      is a new offsetting row"). List/get are the only other endpoints.
- [x] Line totals (`quantity × unit_price`) and the purchase total are
      computed with `Prisma.Decimal`, not native JS number arithmetic --
      same precision reasoning that made `Employees.salary` a Decimal
      column instead of `Float` originally. Verified with a
      hard-to-round-cleanly case (15.50 × 10 + 9.99 × 3) landing exactly on
      184.97, not a floating-point-adjacent value.
      Extracted the `Units` enum to `@lib/enums` (now shared by
      Item and Purchase validators — worth doing once it's reused a second
      time, not before).
- [x] Rejects `paid_amount` exceeding the computed total (400).
- [x] **Closes the loop from Phase 5**: `StockUnit.bind()`'s test now binds
      against a _real_ `PurchaseItem` created through this module's own
      service, not a Prisma-seeded stand-in — confirmed end to end.
- [x] `PurchaseItem` also gets a thin read-only list (filterable by
      `item_id`/`batch_id`) for lot lookups.
- [x] 6 new tests (84 total). Smoke-tested over real HTTP (multi-line
      purchase, over-payment rejection, empty-items rejection, lot listing).
- [ ] Merged to `main`

**Note for Phase 10 (Payments)**: `Purchase.due_amount` is a snapshot set
once at creation. Recording a `Payment` against a purchase later doesn't
currently update it — that reconciliation is Phase 10's job, not built here.

**Phase 8 (Treatment & Monitoring) — done.** Branch
`feat/stock-ledger-and-treatment-api`, ready to merge. Started by closing
the Phase 5 scope gap (`StockLedger`, `InventoryAdjustment`), since
`Consumption` needs both.

- [x] `StockLedger`: **read-only from the client's perspective** — entries
      are written by whatever domain action causes them (`Consumption`,
      `InventoryAdjustment`), never posted directly. `record()` is an
      internal helper that takes a `Prisma.TransactionClient` so it
      composes into the caller's own transaction, not a separate write.
      (Note: `Purchase`, already merged in Phase 7, does **not** yet write
      an IN entry for aggregate items — not retrofitted here to avoid
      reopening a merged phase; flagged as a follow-up.)
- [x] `InventoryAdjustment`: create writes the adjustment row and a
      matching `StockLedger` entry in the same transaction — direction
      follows the sign of `quantity_after - quantity_before`. Rejects a
      no-op correction (before == after).
- [x] `Consumption`: the two-path branch is the core of this phase --
      **coded draw** (`stock_unit_id` set): decrements
      `StockUnit.remaining_quantity`, flips `IN_STOCK → IN_USE`, or
      `→ CONSUMED` at exactly zero; equipment (`remaining_quantity` null)
      just flips to `IN_USE` once, non-depleting. **Aggregate draw** (no
      `stock_unit_id`, e.g. feed): no `StockUnit` involved, writes a
      `StockLedger` OUT entry instead. Verified both paths don't leak into
      each other (a coded draw writes zero `StockLedger` rows; an
      aggregate draw touches zero `StockUnit` rows).
- [x] `Medications`, `Vaccinations`, `EnvironmentRecords`, `WeightRecords`:
      straightforward logging endpoints, no balance math. `WeightRecords`
      enforces its `@@unique([batch_id, house_id, date])` as a 409, not a
      silent overwrite.
- [x] `BatchFeedingProgram`: create + list, plus a narrow
      `setEndDay`-only update (closing out a feed phase early/late is the
      one real edit case; everything else about a program is fixed at
      creation).
- [x] 22 new tests (100 total). Full HTTP smoke test walked both
      `Consumption` branches end to end and confirmed the feed draw
      produced exactly the expected `StockLedger` row while the medicine
      draw produced none.
- [ ] Merged to `main`

**Phase 9 (Sales) — done.** Branch `feat/sales-api`, ready to merge.

- [x] **Schema gap closed**: `BirdSale` had no `house_id`, but the design
      docs are explicit that it's one of only three things allowed to
      touch `BatchHouseBalance` (alongside `BatchHouseAllocation` and
      `MortalityLog`) — impossible without knowing which house's balance
      to decrement. Added `house_id` (required FK to `Houses`), migration
      `20260805202105_add_birdsale_house_id`.
- [x] `Sale` + `SaleItem`: exact mirror of Purchase/PurchaseItem — create
      only, append-only, `Prisma.Decimal` money math.
- [x] `BirdSale`: decrements `BatchHouseBalance` in the same transaction as
      the row insert, same pattern as `MortalityLog`. Deliberately
      **narrow** about what gets server-computed: `total_amount = net_weight
× price_per_kg` and `due_amount` are unambiguous, so those are
      computed. Every regional field (`dholta_in_g`, `total_katha`,
      `avg_wt_per_katha_kg`, `avg_weight_g`) is accepted exactly as the
      client sends it, not derived — `full-schema-analysis.md` explicitly
      warns against touching business logic there's no full context on,
      and guessing a formula would be worse than not having one.
      Cross-field check: `male_count + female_count` must equal
      `birds_count` when both are given.
- [x] **First real test of `Batches.close()`'s reconciliation path**: sold
      300 of 1000 birds, confirmed the balance read 700, confirmed
      close-without-force reported "700 live birds allocated" (the exact
      number), confirmed oversell (selling more than the house balance)
      rejects with 409 and writes zero rows.
- [x] 7 new tests (107 total). Full HTTP smoke test covering both Sale and
      BirdSale, including the balance/close-reconciliation chain.
- [ ] Merged to `main`

**Phase 10 (Payments) — done.** Branch `feat/payments-api`, ready to merge.

- [x] **Resolved the due_amount question from Phase 7/9's note**: since
      `Purchase`/`Sale`/`BirdSale` are append-only, mutating their
      `due_amount` when a `Payment` comes in would violate that. `due_amount`
      stays a create-time snapshot; `PaymentService.getTotalPaidForRef`
      computes the running total by summing `Payment` rows against
      `(ref_type, ref_id)` at read time instead. Exposed as
      `GET /api/payments/total-paid?ref_type=&ref_id=`.
- [x] `Payment`: append-only (create + list + get, no update, same as
      Purchase/Sale). `ref_id` is a polymorphic reference resolved via
      `ref_type` — not a real FK, same untyped-reference pattern
      `StockLedger` already uses, so not validated against the target
      table (consistent, not a new gap).
- [x] `PaymentInstrument`: full CRUD + deactivate/reactivate (has its own
      `is_active`, same pattern as Suppliers/Customers/Houses — not
      `Profiles.is_active`). `owner_id`/`owner_type` is the same
      polymorphic-reference pattern.
- [x] `GET /:id/balance` on `PaymentInstrument`: incoming minus outgoing,
      computed with `Prisma.Decimal` throughout (caught and fixed a first
      draft that used native `Number` for this — same precision standard as
      every other money computation this session).
- [x] 9 new tests (116 total). Smoke-tested over HTTP including the
      FK-violation path (`from_instrument_id` pointing nowhere → clean 400,
      not a 500).
- [ ] Merged to `main`

**Phase 11 (Finance) — done.** Branch `feat/finance-api`, ready to merge.

- [x] `Expense`: append-only (create + list + get), same reasoning as every
      other money-movement table this session — a correction is a new
      offsetting entry, not an edit.
- [x] **The `AssetDepreciation` trigger deferred since Phase 5/6 is built.**
      An `Asset` has no direct link to a `Batch` — but `Consumption` does
      (`batch_id` + `stock_unit_id` together, Phase 8), so "which assets did
      this batch use" resolves to "which Assets' `StockUnit`s appear in this
      batch's `Consumption` rows." Wired into `BatchService.close()`
      (modifying already-merged Phase 6 code, not a new endpoint): for each
      distinct `ACTIVE` asset found that way, `amount = purchase_cost /
  useful_life_batches` (the formula named in
      `inventory-tracking-design.md`), written via `upsert` on
      `(asset_id, batch_id)` so a retried close can't double-compute.
      `AssetDepreciation` itself stays **read-only** from the client's
      perspective — same "written by the domain action, not posted
      directly" pattern as `StockLedger`.
- [x] Verified the full chain over both tests and live HTTP: bound a
      `StockUnit` to a $40,000 asset with `useful_life_batches: 10`,
      consumed it in a batch, closed the batch, got exactly `4000` back.
      Also verified a batch that never touched the asset produces zero
      depreciation rows, and confirmed no regression in the existing
      `Batches.close()` tests from Phase 6.
- [x] 6 new tests (122 total).
- [ ] Merged to `main`

**Phase 12 (Payroll) — done.** Branch `feat/payroll-api`, ready to merge.

- [x] `PerformanceScoreEntry`: fixed point value per criterion, looked up
      server-side from `@lib/performance-criteria.ts` (a plain constant
      map, not a DB table — matches "criteria list is fixed for v1" in the
      design doc). The client **cannot** set `points` for a fixed criterion
      — verified live that submitting `points: 999` against
      `EARLY_PROBLEM_REPORT` still snapshotted `3`. `OTHER` is the one
      exception: client-supplied, validator-bounded to ±1–5 excluding 0.
      (Caught the same missing-`idempotency_key` mistake as Phase 8's
      `InventoryAdjustment` here too — this table was always on the
      original 9-table list, just missed on the first pass.)
- [x] `PayrollRecord.generate`: the "manual month-end action vs. automated
      job" question the design doc left open is resolved the same way
      `Batches.close()` was — manual, admin-triggered. Sums the month's
      `PerformanceScoreEntry` points, clamps to `[-10, +20]`, applies to
      the employee's _current_ baseline salary, locks the result
      (`@@unique([employee_id, month])` — regenerating throws 409, matching
      "even if the baseline changes later, past months stay correct").
- [x] **Verified against the design doc's own worked examples**, not just
      hand-picked numbers: "great month" (+8 → 16200), "bad month" (-12
      floors at -10% → 13500), "runaway great month" (+24 ceilings at
      +20% → 18000) — all three landed exactly on the documented figures,
      both in tests and live over HTTP.
- [x] 9 new tests (131 total).
- [ ] Merged to `main`

**Phase 13 (Alerts) — done.** Branch `feat/alerts-api`, ready to merge.

- [x] **Design call**: FEATURES.md's 5 trigger conditions (low stock,
      mortality spike, expiring stock, payroll due, negative-performance
      pattern) are written as if they're live hooks on every relevant
      write. Instrumenting all 8 already-merged services that would touch
      (Consumption, MortalityLog, Purchase, PayrollRecord,
      PerformanceScoreEntry, ...) is invasive and error-prone to retrofit.
      Built `POST /api/alerts/scan` instead — reconciles current state
      against all 5 conditions on demand, dedupes against existing
      `ACTIVE` alerts by `(type, related_id)` so re-running doesn't spam.
      Meant to run periodically (a cron, once one exists) or manually;
      arguably *more* robust than event hooks for conditions that develop
      gradually (a lateness pattern, a slow stock drain) rather than
      firing at one exact moment.
- [x] Low stock: aggregate balance from `StockLedger` (IN − OUT) per item
      vs `reorder_level`, routed to `FEED` or `MEDICINE` alert type by
      category.
- [x] Mortality spike: 24h death count ÷ current live balance per
      `RUNNING` batch, >1% → `CRITICAL`.
- [x] Expiring stock: `PurchaseItem.expiration_date` within 30 days →
      `MEDICINE WARNING`.
- [x] Payroll due: any active employee missing a `PayrollRecord` for last
      month, checked from the 5th of the month onward → `EMPLOYEE INFO`.
- [x] Negative performance pattern: net `PerformanceScoreEntry` points this
      month ≤ −5 → `EMPLOYEE WARNING`.
- [x] Manual `Alerts` CRUD (create/list/get/resolve) alongside the scan,
      for anything that doesn't fit an automated rule.
- [x] 10 new tests (137 total), including an explicit re-run-doesn't-
      duplicate check. Smoke-tested live — the scan caught a freshly
      created item with zero ledger balance below its reorder level.
- [ ] Merged to `main`

**Remaining phases**: 14 (Audit Log) is blocked on 15 (Auth) for its write
side per the original plan — the read/list API doesn't strictly need Auth
first, so it could go next if useful before Auth lands. 16 (Analytics) reads
across everything built so far and can go anytime. 15 itself stays blocked
on a credential-scheme design decision.

**Fixed in Phase 2 (context for future modules):** the `is_active`
query-param schema had `.optional().transform(...)` after it, which — under
`exactOptionalPropertyTypes` — makes the _output_ key required-with-
`undefined` instead of genuinely optional. Fixed pattern: keep the schema as
a plain `z.enum(["true","false"]).optional()` and convert to boolean at the
point of use in the service. All four modules built since (Employees,
Suppliers, Customers) follow this.

**Deliberately deferred to Phase 15 (Auth):** the generic `AuditLog`-writing
middleware originally slated for Phase 0. Building it now would mean
inventing a fake `changed_by_id` — there's no request-scoped actor identity
until auth exists (Admins management is itself how actor accounts get
created; nothing to attribute the very first row to). Revisit once auth
lands and every request has a real caller.

## Log

- 2026-08-06 — Phase 0/1 started.
- 2026-08-06 — Phase 0/1 done. Found and fixed 3 real pre-existing bugs
  while building: `withHandler` double-wrapped responses that already called
  `sendSuccess` (matches the README's own documented controller pattern —
  every list/detail endpoint was silently returning `{}`); `c.get(
"validatedBody")` was never populated by Hono (added `@lib/valid`'s
  `getValid()` reading the real `c.req.valid()` API instead); and
  `bun run db:migrate`/`db:generate` silently needed `.env` pre-sourced
  because `bunx prisma`'s subprocess doesn't inherit Bun's own `.env`
  auto-load (fixed in `prisma.config.ts`). All three would have hit every
  future module, so fixing now instead of working around them per-module.
- 2026-08-06 — Phase 2 done. Employees module built and verified; fixed the
  `is_active` optional+transform typing gap (see above), applied to both
  Admins and Employees.
- 2026-08-06 — Phase 3 done. Suppliers (full CRUD), Customers (full CRUD),
  Doctors (create+list+get) built and verified. Confirmed
  Suppliers/Customers deactivate their own `is_active`, not
  `Profiles.is_active` — the one real shape difference from Phase 1/2.
- 2026-08-06 — Phase 4 done. Added `Houses.is_active` (schema gap, closed
  before Batches needs it), built Houses CRUD. User asked to proceed
  through phases continuously rather than stopping after each one.
- 2026-08-06 — Phase 5 done. Item/Warehouses/Organization/StockUnit/Asset
  built. Found and fixed a real bug: unhandled P2003 (FK violation) leaking
  as a raw 500 on StockUnit.bind — generalized the fix into
  handlePrismaWriteError so every future module gets it for free.
- 2026-08-06 — Phase 6 done. Batches/BatchHouseAllocation/
  BatchHouseBalance/MortalityLog built, with the transactional balance
  math verified both by tests that check rollback (not just the thrown
  error) and by a full create→transfer→mortality→close smoke test over
  real HTTP.
- 2026-08-06 — Phase 7 done. Purchase/PurchaseItem built (create-only,
  append-only per design), using Prisma.Decimal for money math instead of
  native numbers. StockUnit.bind's test now uses a real PurchaseItem from
  this module instead of a seeded stand-in.
- 2026-08-06 — Phase 8 done. Closed a Phase 5 scope gap (StockLedger,
  InventoryAdjustment) first, then built Consumption/Medications/
  Vaccinations/EnvironmentRecords/WeightRecords/BatchFeedingProgram.
  Consumption's coded-vs-aggregate branch is the real logic in this phase;
  verified both paths in isolation over real HTTP.
- 2026-08-06 — Phase 9 done. Added BirdSale.house_id (schema gap -- it's
  one of the three things allowed to touch BatchHouseBalance but had no
  house reference). Built Sale/SaleItem/BirdSale; first real test of
  Batches.close()'s reconciliation against actual sales, not just force:true.
- 2026-08-06 — Phase 10 done. Payment/PaymentInstrument built. Resolved
  the due_amount question flagged in Phase 7/9: append-only tables can't
  have due_amount mutated, so outstanding balance is computed by summing
  Payment rows at read time. Caught a Number-vs-Decimal slip in the balance
  computation before it shipped.
- 2026-08-06 — Phase 11 done. Expense built; the AssetDepreciation trigger
  deferred since Phase 5/6 finally wired into Batches.close() now that
  Consumption exists to link an asset's StockUnit back to a batch.
  Verified 40000/10=4000 exactly over both tests and live HTTP, plus no
  regression in Phase 6's existing close() tests.
- 2026-08-06 — Phase 12 done. PerformanceScoreEntry (fixed points per
  criterion, server-computed, OTHER as the bounded escape hatch) and
  PayrollRecord (manual generate, clamp [-10,+20]) built. Verified against
  all three of the design doc's worked examples exactly (16200/13500/18000).
- 2026-08-06 — Phase 13 done. Built alerts as an on-demand reconciliation
  scan (POST /api/alerts/scan) instead of live hooks on 8 already-merged
  services -- covers all 5 FEATURES.md trigger conditions, dedupes against
  existing ACTIVE alerts. Manual Alerts CRUD alongside it.
