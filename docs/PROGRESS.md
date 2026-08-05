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
| 5   | Inventory                               | `Item`, `Warehouses`, `Organization`/`ItemOrganization`, `StockUnit`, `Asset`                              | 0                   | ✅                                                                                                                                |
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
(`recorded_by_id` on `MortalityLog`/`Consumption`/etc. in upcoming phases)
will need the same treatment as a required client-supplied field, until
Phase 15 replaces it with a real session. Noting this now so Phase 6+
doesn't need to re-derive the decision.

**Next up: Phase 6 (Batches)** — `Batches`, `BatchHouseAllocation`,
`BatchHouseBalance`, `MortalityLog`. First module with the
transactional-balance-update pattern (`BatchHouseBalance` must update in
the same transaction as any allocation/mortality/sale touching that
batch+house) and the first required `recorded_by_id` fields.

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
