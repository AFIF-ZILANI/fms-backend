# FMS — System Design Arc

Ties together `docs/PREVIOUS_CONTEXT.md` (original planning), the three feature
designs (inventory, batch management, employee payroll), and
`server/prisma/schema.prisma` into one picture of how the whole system fits
together.

## 1. Mission, in one paragraph

ZeroD Farms has no reliable audit trail today — cash expenses go untracked, nobody
knows true per-batch profit, and paper/memory is the system of record. FMS exists to
make same-day, accountable data capture the path of least resistance, not an extra
chore — every design decision so far (append-only ledgers, required actor fields on
every entry, offline-first capture) serves that one goal.

## 2. High-level architecture

```mermaid
graph TB
    subgraph Clients
        PWA["FMS PWA (Vite+React)<br/>Owner/Admin — financial ledger, reporting"]
        MOBILE["Field App (future, separate design)<br/>Workers/Managers — daily execution, QR scan"]
        POULTRYSCALE["PoultryScale (external app)<br/>Weighing/sales, references FMS batch_id"]
    end

    subgraph "Local-first layer"
        IDB["IndexedDB queue<br/>writes land here first, sync when online"]
    end

    subgraph Backend
        API["Bun + Hono API<br/>routes → Zod validation → service layer"]
        SVC["Service modules<br/>Batch · Inventory · Purchasing · Payroll · Sales · Reporting"]
        AUDIT["Audit middleware<br/>writes AuditLog on every mutation"]
    end

    DB[("Postgres<br/>via Prisma")]

    PWA --> IDB --> API
    MOBILE --> IDB
    POULTRYSCALE -. batch_id lookup .-> API
    API --> SVC --> AUDIT --> DB
```

Three clients, one backend, one database. The Field App and its QR-scanning flow are
still a separate design conversation ("discuss later"), but the printed-code system
(`inventory-tracking-design.md`) already assumes it as the eventual scanning surface —
manual code entry is the v1 stand-in until it exists.

## 3. Backend layering

```
routes (Hono)  →  Zod schemas (input validation)  →  service layer  →  Prisma  →  Postgres
```

Service modules map roughly to the design docs, and each owns a cluster of tables —
this is the boundary that keeps the codebase from becoming one undifferentiated blob
as it grows:

| Service       | Owns                                                                                                                               | Encodes                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Batch**     | `Batches`, `BatchHouseAllocation`, `BatchHouseBalance`, `MortalityLog`                                                             | Placement, brooder→grower transfer, mortality, the batch-closing lifecycle (not yet defined — see §7) |
| **Inventory** | `Item`, `Purchase`, `PurchaseItem`, `StockUnit`, `Asset`, `AssetDepreciation`, `Consumption`, `StockLedger`, `InventoryAdjustment` | Lot costing, code binding, consumption/depletion, depreciation                                        |
| **Treatment** | `Medications`, `Vaccinations`, `EnvironmentRecords`, `WeightRecords`                                                               | Links treatment records to actual stock draws via `Consumption`                                       |
| **Payroll**   | `PerformanceScoreEntry`, `PayrollRecord`, `PayrollPayout`, `EmployeePayoutAccount`, `Employees`                                     | Point-ledger scoring, monthly clamp-and-compute, proof-of-transfer payout                             |
| **Sales**     | `Sale`, `SaleItem`, `BirdSale`                                                                                                     | Revenue recognition                                                                                   |
| **Money**     | `Expense`, `Payment`, `PaymentInstrument`                                                                                          | Cost classification (`cost_type`), cash movement. Payroll writes here but is not authored here — §4    |
| **Reporting** | reads across all of the above                                                                                                      | Bird-days allocation (v2), batch P&L, payroll summaries                                               |

Reporting is deliberately read-only against the other modules' tables rather than
owning any of its own — it has no state to be accountable for, only queries.

## 4. Three flows, end to end

**Chicks arrive** → Purchasing records a `Purchase` + `PurchaseItem` (`batch_id` set,
since chicks fund a specific batch from day one) → Batch service creates a matching
`BatchHouseAllocation` (`reason=INITIAL`, into the brooder house) → `BatchHouseBalance`
updates in the same transaction. Financial event and physical event stay two records,
linked by `batch_id`, matching "a batch exists financially before any bird is
weighed."

**A medicine bottle gets used** → Inventory service resolves the scanned/entered
`code` to a `StockUnit` → looks up its `purchase_item.unit_price` for costing →
Treatment service writes a `Consumption` row (`batch_id`, `house_id`, `quantity`) →
`StockUnit.remaining_quantity` decrements, `Medications.consumption_id` links back.
One bottle can span this sequence across several batches and houses over its life.

**Month end payroll** → for each employee, sum `PerformanceScoreEntry.points` for the
month → clamp to `[-10, +20]` → apply to `Employees.reference_salary` → write one
`PayrollRecord` (locked snapshot) → a `PayrollPayout` against that record carries the
money out, snapshotting the destination off the employee's active
`EmployeePayoutAccount` and deriving the transfer fee the farm absorbs.

Confirming that payout is the accounting event, and it fans out into the Money
module inside one transaction: a `SALARY` `Expense` for the wage, a
`SALARY_TRANSFER_FEE` `Expense` for the fee, and one `OUTGOING` `Payment` for the
cash that left the farm's wallet — wage plus fee, since that is what moved in one
transfer — with `ref_type = PAYROLL` pointing back at the payout.

Two things about that shape are deliberate and easy to get backwards:

- **The payout is the authority, `Payment` is the consequence.** A wage cannot be
  paid by writing a `Payment` row: `createPaymentSchema` refuses `ref_type =
  PAYROLL`, because only `PayrollPayout` can make proof of transfer a condition of
  being marked paid. `Payment` remains the general cash ledger and payroll appears
  in it — it is just not authored there. See `docs/payroll-ledger-bridge.md`.
- **The cash row references the payout, not the `PayrollRecord`.** The record is a
  calculation; the payout is the transfer. One `Payment` per transfer keeps an
  instrument's statement lined up with the provider's own.

Wages land as `SHARED_PERIOD`, so they are farm-wide cost and stay out of batch P&L
until the bird-days allocation in §7 — a `PayrollRecord` has no batch, and shed
labour spans whatever batches are running that month.

## 5. Offline-first sync

The original stack decision (Vite+React PWA, IndexedDB queue, sync on reconnect) is
why almost every entry table requires an actor (`recorded_by_id`) and a client-set
`date`/`occurred_at` distinct from server `created_at` — a write made in a shed with
no signal has to carry enough information to be trustworthy once it lands, whenever
that is.

**Gap worth closing before real field entry starts**: only `StockLedger` currently has
an `idempotency_key`. Every table a client can write to _offline_ — `Consumption`,
`MortalityLog`, `BatchHouseAllocation`, `PerformanceScoreEntry` — needs the same
protection, or a flaky connection retrying a queued sync will double-insert. Same
mechanism as `StockLedger` already models (a client-generated unique key), just not
yet applied everywhere it's needed. Worth doing before writing sync code, not after a
duplicate mortality entry is discovered in production.

## 6. Accountability & audit model

- Every entry that matters names who made it (`recorded_by_id` / `given_by_id` /
  `administered_by_id` / `bound_by_id`) — added specifically because the reference
  schema left several of these blank (see `full-schema-analysis.md`).
- Append-only tables (`Consumption`, `MortalityLog`, `BatchHouseAllocation`,
  `PerformanceScoreEntry`, `StockLedger`, `Purchase`/`PurchaseItem`, sales, payments)
  are never edited — a correction is a new offsetting row. This needs to be enforced
  at the application layer (no `UPDATE`/`DELETE` code path exposed for these tables),
  since Postgres/Prisma won't stop a service function from doing it.
- `AuditLog` covers the mutable tables (`Item`, `Batches`, `Employees`, `StockUnit`
  status/location changes, etc.) where edits are legitimate and history still matters.
  **Recommend a Prisma middleware** (`$use` / extension) that writes `AuditLog`
  automatically on every update to a registered model, rather than scattering manual
  audit-write calls through service code — a forgotten call is a silent gap, a
  middleware can't be skipped by accident.
- Nothing gets hard-deleted. `is_active` flags exist specifically so deactivating a
  Profile/Item/Supplier/Customer never breaks a foreign key or destroys history.

## 7. What's still genuinely undecided

- **Batch-closing trigger**: what actually moves `Batches.status` from `RUNNING` to
  `CLOSED`/`SOLD`, and does that action automatically fire `AssetDepreciation`
  computation and finalize the month's bird-days allocation? This has been flagged
  three times across the design docs and is worth resolving before building the Batch
  service, since several other features assume it exists.
- **Bird-days allocation engine** — intentionally v2, needs 2-3 batches of real
  overlapping data to validate against before writing the formula.
- **Auth/role enforcement** — the schema has the actors (`UserRole`,
  `EmployeeRoleNames`) but no permission layer yet; matches the original "single-user
  for v1" plan, becomes required once a second person starts entering data.
- **Pre-bridge payroll cash** — the 8 payouts confirmed before the payroll→ledger
  bridge have `SALARY` expenses but no cash rows, because nobody recorded which
  wallet those transfers left. `cash_position` is ৳98,070 optimistic until someone
  confirms an opening adjustment against the instrument that actually paid. The
  number is known; only the wallet is not. See `docs/payroll-ledger-bridge.md`.
- **Postgres hosting** (Supabase/Neon/Railway/self-hosted) — unchanged open item from
  the original plan.
- **Field App design** — the mobile scanning/execution app is referenced throughout
  as the eventual consumer of QR codes and daily logging, but has no design of its own
  yet, by your own choice to defer it.

## 8. Verification so far

```
cd server && bun test src/services/     # 321 tests across 40 files, against real Postgres
cd server && npx tsc --noEmit           # 10 errors, all in two test files -- see below
cd web    && npx tsc --noEmit && npx vite build   # clean
```

The design surface is no longer the whole story: **29 migrations are applied against
a real Postgres database**, the server exposes 52 route groups over a full service
layer, and the web app has 15 page modules. Every service test runs against the real
database rather than a mock, so the suite exercises Prisma's query engine on every
run.

That closes what §7 used to list as the ORM/runtime gap: `prisma generate` produces a
working client (7.8.0) and 321 tests execute real queries through it **under Bun**,
which is the evidence that item asked for. Prisma over Drizzle is settled.

`tsc` is **not** clean on the server: `item.service.test.ts` and
`organization.service.test.ts` pass unit codes (`ML`, `G`) that the `Unit` enum no
longer carries, 10 errors between them. They are test fixtures written against an
older enum, no source file is affected, and `bun test` passes because Bun strips
types rather than checking them — which is exactly why the errors survived. Worth
clearing, or the next real type error hides in the noise.

Still only a design: the **Field App**. `mobile/` is scaffolded — config, assets,
lockfile — with no screens in it yet.
