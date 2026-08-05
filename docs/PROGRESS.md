# FMS API — Implementation Progress

Tracks build order and status against `docs/FEATURES.md`. One phase = one
branch = one merge to `main` (per the mandatory branch workflow). Update the
status marker as work moves — this file is the persistent memory of where
the build is, read it first when resuming.

Status key: `⬜ not started` · `🔨 in progress` · `✅ done` · `⛔ blocked`

| #   | Phase                           | Models                                                                                                     | Depends on          | Status                                                                                                                            |
| --- | ------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Foundation                      | DB, env, drop stale `user.*` scaffold                                                                      | —                   | ✅                                                                                                                                 |
| 1   | **Admins**                      | `Profiles` (role=ADMIN), `Admins`                                                                          | 0                   | ✅                                                                                                                                 |
| 2   | Employees                       | `Profiles` (role=EMPLOYEE), `Employees`                                                                    | 0                   | ⬜                                                                                                                                |
| 3   | Suppliers / Customers / Doctors | `Suppliers`, `Customers`, `Doctors`                                                                        | 0                   | ⬜                                                                                                                                |
| 4   | Houses                          | `Houses`                                                                                                   | 0                   | ⬜                                                                                                                                |
| 5   | Inventory                       | `Item`, `Warehouses`, `Organization`/`ItemOrganization`, `StockUnit`, `Asset`                              | 0                   | ⬜                                                                                                                                |
| 6   | Batches                         | `Batches`, `BatchHouseAllocation`, `BatchHouseBalance`, `MortalityLog`                                     | 4                   | ⬜                                                                                                                                |
| 7   | Purchases                       | `Purchase`, `PurchaseItem`                                                                                 | 3, 5, 6             | ⬜                                                                                                                                |
| 8   | Treatment & Monitoring          | `Medications`, `Vaccinations`, `EnvironmentRecords`, `WeightRecords`, `BatchFeedingProgram`, `Consumption` | 5, 6                | ⬜                                                                                                                                |
| 9   | Sales                           | `Sale`, `SaleItem`, `BirdSale`                                                                             | 3, 5, 6             | ⬜                                                                                                                                |
| 10  | Payments                        | `Payment`, `PaymentInstrument`                                                                             | 7, 9                | ⬜                                                                                                                                |
| 11  | Finance                         | `Expense`, `AssetDepreciation` (batch-close trigger)                                                       | 5, 6                | ⬜                                                                                                                                |
| 12  | Payroll                         | `PerformanceScoreEntry`, `PayrollRecord`                                                                   | 2                   | ⬜                                                                                                                                |
| 13  | Alerts                          | `Alerts` (+ trigger rules)                                                                                 | 1–12 (reads across) | ⬜                                                                                                                                |
| 14  | Audit Log (read API + write middleware) | `AuditLog`                                                                                          | 15                  | ⬜                                                                                                                                |
| 15  | Auth & permission enforcement   | —                                                                                                          | 1, 2                | ⛔ blocked — no credential scheme decided yet (schema has no password/OTP field); needs its own design pass before implementation |
| 16  | Analytics                       | reads everything                                                                                           | 1–14                | ⬜                                                                                                                                |

## Current step

**Phase 0 + Phase 1 — done.** Branch `feat/admins-api`, ready to merge.

- [x] Postgres reachable locally, `fms` DB created, `.env` written
- [x] `prisma migrate dev` run — first migration applied
- [x] Stale `src/**/user.*` files removed (referenced a `User` model that
      doesn't exist in this schema — dead template scaffolding)
- [x] `Admins` module: validator → service → controller → routes
- [x] Tests written and passing (`bun test src/services/admin.service.test.ts`)
- [x] Dev server smoke-tested against real endpoints (full CRUD + conflict +
      not-found + validation paths, curl'd against a live server)
- [ ] Merged to `main`

**Next up: Phase 2 (Employees)** — same shape as Admins (`Profiles` +
`Employees`), reusing `@lib/pagination` and `@lib/prisma-errors` as-is.

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
