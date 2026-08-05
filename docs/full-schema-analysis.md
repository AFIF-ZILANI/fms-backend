# Full Schema — Analysis

Companion to `codes/schema.prisma` (validated with `prisma validate`). Base is
`codes/previous_schema.prisma`; this documents every delta and why.

## Removed (dead or superseded)

- **`HouseEvents` + `EventType` enum** — generic FEED/WATER/MORTALITY event log,
  replaced by a focused `MortalityLog` (the only one actually tracked; see
  `batch-management-design.md`).
- **`BatchSuppliers`** — `@@unique([batch_id, supplier_id])` blocked the same
  supplier delivering chicks to the same batch twice at a different price, a real
  case you described. Chicks now flow through `PurchaseItem.batch_id` like every
  other lot.
- **`HouseFeedInventory`** — a "quantity remaining per house" cache only makes sense
  if there's a depletion event separate from delivery. There isn't one (feed is
  tracked at allocation granularity only), so the field would silently go stale.
- **`StockReservation`** — a "planned/reserved but not yet allocated" concept with no
  stated need once feed tracking is allocation-only. Cut per YAGNI; nothing currently
  reads or writes it. Straightforward to add back if advance reservations become a
  real workflow.
- **`TransactionTypes`, `PaymentStatus` enums** — defined in the reference schema,
  referenced by no field anywhere. Dead.
- **`Batches.farm_code` / `product_code` / `sector_code`** — speculative multi-farm
  scaffolding with no corresponding `Farm` model and no stated current need (FMS plan
  is explicitly single-farm for now). Cut; multi-farm is a big enough change to design
  properly when it's real, not scatter placeholder strings now.

## Added (closes gaps flagged across the three design docs)

- **`StockUnit`, `Asset`, `AssetDepreciation`** — physical unit tracking for
  medicine/vaccine/equipment (`inventory-tracking-design.md`), plus a home for the
  equipment depreciation math that's been flagged as an open item three times now.
  `AssetDepreciation` is one row per batch an asset served, `amount` = the
  `purchase_cost / useful_life_batches` share — the computation itself is still
  application logic (triggered at batch close), but the data now has somewhere to
  live.
- **`CostType` enum + `Expense.cost_type`** — direct/shared_period/shared_capital
  classification from the original FMS plan, finally wired into the real schema.
  `ExpenseCategory` also expanded (added RENT, WATER, FUEL, MAINTENANCE, VET_FEE) —
  the original 4-value enum didn't cover normal farm operating costs.
- **`PerformanceScoreEntry`, `PayrollRecord`, `PerformanceCriterion` enum** — the
  employee payroll design (`employee-payroll-design.md`), as agreed: single
  point-ledger per employee per month, fixed criteria values, -10%/+20% clamp.
- **`AuditLog`** — generic `(table_name, record_id, action, changed_by, before/after
json)` trail for anything mutable. This is the "full audit" piece: it can't enforce
  itself — something (a Prisma middleware or service-layer wrapper) has to actually
  write to it on every update — but the schema now has a place for that trail to live
  instead of relying purely on `updated_at` overwriting history.
- **`recorded_by_id` / `bound_by_id` fields** added to `Consumption`,
  `BatchHouseAllocation`, `EnvironmentRecords`, `Sale`, `BirdSale`,
  `InventoryAdjustment`, `StockUnit` — these had **no actor field at all** in the
  reference schema. "Who logged this feed allocation, who recorded this bird
  transfer, who took this environment reading" was previously unanswerable. This is
  most of what "execution accountability" means concretely: every write that matters
  now names who did it, not just when.
- **`Profiles.is_active`, `Item.is_active`, `Customers.is_active`,
  `Suppliers.is_active`** — soft-deactivation flags. Nothing in this system should
  ever be hard-deleted once it has history attached (a Profile scored an employee, a
  Supplier has purchases, an Item has a ledger) — deleting the row would either
  cascade-destroy real records or leave orphaned foreign keys. Deactivate, don't
  delete.

## Fixed (real bugs in the reference schema, not stylistic)

- **`Employees.salary` was `Float`** — wrong type for currency (binary floating point
  loses cents). Changed to `Decimal(10,2)`, matching every other money field.
- **`Medications.administered_by` / `Vaccinations.administered_by` pointed at
  `Admins`** — meaning only the Owner/Admin could ever be recorded as administering
  treatment, when in practice workers and managers do this daily. Changed to point at
  `Profiles` directly.
- **`EnvironmentRecords.house_no` was a raw `Int`**, disconnected from the actual
  `Houses` table that already exists. Changed to a proper `house_id` foreign key.
- **`InventoryAdjustment.created_by` was a bare `String`**, not a foreign key — no
  referential integrity, a typo'd ID would silently fail to resolve to anyone.
  Changed to `recorded_by_id → Profiles`.
- **`Item.normalized_key` was optional** despite existing specifically to prevent
  duplicate item rows (e.g. "Amoxicillin" vs "amoxicillin" splitting inventory across
  two rows). Made required and unique — that's the only way it actually does its job.

## Kept as-is, deliberately not touched

- **Naming convention** (mixed plural/singular model names — `Batches` vs `Item`) —
  inherited inconsistency from the reference schema. A rename touches every model and
  every generated client call for zero functional gain; not worth the diff.
- **`Organization` / `ItemOrganization`** (manufacturer/importer/distributor per
  item) — arguably more structure than a small farm needs today, but medicine/vaccine
  recall tracing is a legitimate reason to know which manufacturer's batch something
  came from. Left alone rather than cut speculatively.
- **`BirdSale`'s regional fields** (`dholta_in_g`, `total_katha`,
  `avg_wt_per_katha_kg`) — kept exactly as originally defined. These encode local
  units/business meaning I don't have full context on; cutting them without
  understanding what they mean would be a real data-loss risk, not an optimization.

## Optimizations

- Decimal precision standardized: `(10,2)` for all money, `(10,3)` for all
  quantities — was inconsistent in the reference schema (some quantities used
  `Decimal(10,3)`, others plain `Int`/`Float`).
- Indexes added on every foreign key that gets filtered/sorted by in an obvious query
  pattern (`batch_id + date`, `house_id + date`, `status`, `cost_type`) rather than
  relying on Prisma's implicit relation indexing alone.
- `RefType.STOCK_UNIT` (added mid-design, then removed) — caught in self-review as an
  enum value with no field ever setting it, since coded items bypass `StockLedger`
  entirely by design.

## Still open (not blocking, tracked across all three design docs)

- Batch-closing lifecycle: what triggers `RUNNING → CLOSED/SOLD`, and does closing
  automatically compute `AssetDepreciation` rows and finalize bird-days allocation?
  The schema supports it; the trigger logic doesn't exist yet.
- Bird-days shared-period allocation formula itself — v2 work per the original plan.
- Who-can-score-whom and other role-based permission enforcement — schema-ready,
  not access-controlled; deferred to the multi-user auth phase.
- `AuditLog` population is an application-layer discipline, not something the schema
  can force — worth deciding early (Prisma middleware vs explicit service-layer
  writes) before real data entry starts, since retrofitting audit coverage onto
  existing data is much harder than building it in from day one.

## Verification

```
cd codes && npx prisma validate --schema=./schema.prisma
```

Passes as of this doc. No migration has been run — no database exists yet.
