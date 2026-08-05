# FMS API — Implementation Progress

Tracks build order and status against `docs/FEATURES.md`. One phase = one
branch = one merge to `main` (per the mandatory branch workflow). Update the
status marker as work moves — this file is the persistent memory of where
the build is, read it first when resuming.

Status key: `⬜ not started` · `🔨 in progress` · `✅ done` · `⛔ blocked`

| #   | Phase                                   | Models                                                                                                     | Depends on          | Status                                                                                                                            |
| --- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Foundation                              | DB, env, drop stale `user.*` scaffold                                                                      | —                   | ✅                                                                                                                                |
| 1   | **Admins**                              | `Profiles` (role=ADMIN), `Admins`                                                                          | 0                   | ✅                                                                                                                                |
| 2   | Employees                               | `Profiles` (role=EMPLOYEE), `Employees`                                                                    | 0                   | ✅                                                                                                                                |
| 3   | Suppliers / Customers / Doctors         | `Suppliers`, `Customers`, `Doctors`                                                                        | 0                   | ✅                                                                                                                                |
| 4   | Houses                                  | `Houses`                                                                                                   | 0                   | ✅                                                                                                                                |
| 5   | Inventory                               | `Item`, `Warehouses`, `Organization`/`ItemOrganization`, `StockUnit`, `Asset`                              | 0                   | ⬜                                                                                                                                |
| 6   | Batches                                 | `Batches`, `BatchHouseAllocation`, `BatchHouseBalance`, `MortalityLog`                                     | 4                   | ⬜                                                                                                                                |
| 7   | Purchases                               | `Purchase`, `PurchaseItem`                                                                                 | 3, 5, 6             | ⬜                                                                                                                                |
| 8   | Treatment & Monitoring                  | `Medications`, `Vaccinations`, `EnvironmentRecords`, `WeightRecords`, `BatchFeedingProgram`, `Consumption` | 5, 6                | ⬜                                                                                                                                |
| 9   | Sales                                   | `Sale`, `SaleItem`, `BirdSale`                                                                             | 3, 5, 6             | ⬜                                                                                                                                |
| 10  | Payments                                | `Payment`, `PaymentInstrument`                                                                             | 7, 9                | ⬜                                                                                                                                |
| 11  | Finance                                 | `Expense`, `AssetDepreciation` (batch-close trigger)                                                       | 5, 6                | ⬜                                                                                                                                |
| 12  | Payroll                                 | `PerformanceScoreEntry`, `PayrollRecord`                                                                   | 2                   | ⬜                                                                                                                                |
| 13  | Alerts                                  | `Alerts` (+ trigger rules)                                                                                 | 1–12 (reads across) | ⬜                                                                                                                                |
| 14  | Audit Log (read API + write middleware) | `AuditLog`                                                                                                 | 15                  | ⬜                                                                                                                                |
| 15  | Auth & permission enforcement           | —                                                                                                          | 1, 2                | ⛔ blocked — no credential scheme decided yet (schema has no password/OTP field); needs its own design pass before implementation |
| 16  | Analytics                               | reads everything                                                                                           | 1–14                | ⬜                                                                                                                                |

## Current step

**Phase 4 (Houses) — done.** Branch `feat/houses-api`, ready to merge.
Working continuously through phases now (per user instruction) — brief
per-phase notes below instead of a full stop-and-report each time.

- [x] **Schema gap closed**: `Houses` was the one model missing the
      `is_active` soft-delete flag every other people/business-record model
      has (Profiles, Item, Customers, Suppliers). Added it now, before
      Batches (Phase 6) starts attaching mortality/allocation/environment
      history to houses that would make hard deletion unsafe. Migration
      `20260805194604_add_houses_is_active` applied.
- [x] `Houses` module: CRUD + deactivate/reactivate, filterable by
      `type`/`is_active`. No linked Profile — simplest module so far, no
      transaction needed on create, no unique-constraint handling (no
      `@@unique` on the model).
- [x] 7 tests passing (35 total across all modules)
- [x] Dev server smoke-tested (create, invalid-type validation, filter,
      deactivate)
- [ ] Merged to `main`

**Next up: Phase 5 (Inventory)** — meaningfully bigger: `Item` catalog,
`Warehouses`, `Organization`/`ItemOrganization`, `StockUnit` (the
QR-code-per-unit tracking), `Asset`. First module with the coded-unit
lifecycle (`UNASSIGNED → IN_STOCK → IN_USE → CONSUMED/DISPOSED`) from
`inventory-tracking-design.md`.

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
