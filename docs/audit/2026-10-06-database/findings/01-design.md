# Findings 01 — Schema design & integrity
- Date: 2026-10-06
- Commit: server@df7bc95
- Files analyzed: prisma/schema.prisma; prisma/migrations/*/migration.sql (all 30); src/services/{analytics,alert,asset,batch,batch-house-allocation,bird-sale,consumption,customer,employee,employee-payout-account,expense,house,ingest,inventory-adjustment,item,medication,mortality-log,payment,payment-instrument,payroll-payout,payroll-record,purchase,sale,stock-ledger,stock-unit,supplier,transfer,vaccination,warehouse,weight-record}.service.ts; src/lib/{enums,lookup-factory,stock-balance,stock-value}.ts; src/routes/{unit,item-category,expense-category,task-type,employee}.routes.ts; src/controllers/employee.controller.ts; src/validators/{payment,payment-instrument,transfer,inventory-adjustment,bird-sale,purchase,expense,weight-record,environment-record,employee,employee-payout-account,payroll-payout,ingest}.validator.ts; docs/system-design-arc.md; docs/full-schema-analysis.md; docs/api.md

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 5 |
| Medium | 10 |
| Low | 6 |
| **Total** | **21** |

Baseline fact used throughout: **the migrations contain no CHECK constraints, no partial or expression indexes and no triggers.** A grep of all 30 `migration.sql` files for `CHECK`, `WHERE` on `CREATE UNIQUE INDEX` and `TRIGGER` finds nothing. So every invariant beyond NOT NULL, FK and plain UNIQUE is enforced only in application code.

---

### D-1: `due_amount` is a create-time snapshot, but the dashboard reads it as a live balance
- Severity: high
- Location: prisma/schema.prisma:814, :1174, :1225 (`due_amount` on Purchase / Sale / BirdSale); src/services/analytics.service.ts:212-214, :222-224, :239
- Evidence: payment.service.ts:86-90 states the design: "due_amount on the referenced Purchase/Sale/BirdSale is a create-time snapshot and stays that way … outstanding balance is computed by summing Payment rows against ref_id at read time". sale.service.ts:62-68 and analytics.service.ts:426 (`row.due_amount.minus(paid.get(row.id) …)`) net payments off correctly. The dashboard summary does not:
  ```ts
  prisma.purchase.aggregate({ _sum: { due_amount: true } }),   // :212
  prisma.sale.aggregate({ _sum: { due_amount: true } }),       // :213
  prisma.birdSale.aggregate({ _sum: { due_amount: true } }),   // :214
  ...
  outstanding_payables: purchasesDue._sum.due_amount ?? ...    // :239
  ```
  Separately, `paid_amount` entered at create time (purchase.service.ts:93, sale.service.ts:92, bird-sale.service.ts:82) writes no `Payment` row and names no instrument. That cash never reaches `PaymentInstrument` balances (payment-instrument.service.ts:106-108 sums only `Payment`), so `cash_position` leaves it out.
- Impact: `outstanding_payables` and `outstanding_receivables` on the dashboard never go down when a payment is recorded. They overstate debt by every payment made after creation. The column name `due_amount` invites the same mistake in any new query.
- Direction: Either rename the column to make "snapshot" explicit and fix analytics to net payments, or drop the stored copy and derive due from total minus the sum of Payments. Record create-time `paid_amount` as a `Payment` row.

### D-2: Lookup `code` changes on rename, but code depends on literal codes
- Severity: high
- Location: src/lib/lookup-factory.ts:102 (`options.stableCode ? { label } : { code, label }`); src/routes/unit.routes.ts:7, item-category.routes.ts:7, expense-category.routes.ts:7 (no `stableCode`); FKs that cascade the rename: schema.prisma:752, :754, :787, :834, :950, :1120, :1190, :1244
- Evidence: Renaming a Unit, ItemCategory or ExpenseCategory label regenerates its `code`, and `onUpdate: Cascade` rewrites every referencing row. Meanwhile the code matches on literal codes:
  - analytics.service.ts:281 `item: { category: "FEED" }` (feed/FCR analytics)
  - alert.service.ts:60 `item.category === "MEDICINE" || item.category === "VACCINE"`
  - lib/enums.ts:14 `ITEM_BASE_UNITS = ["LITER", "KG", "UNIT", "DOSE", "PCS", "METER"]` (the validator for `Item.unit`)
  - lib/enums.ts:20 `GENERIC_ITEM_UNITS = new Set(["CONTAINER"])`
  - payroll-payout.service.ts:15-16 `SALARY`, `SALARY_TRANSFER_FEE`, upserted by code at :154-158
  
  `stableCode` exists for exactly this reason (lookup-factory.ts:51-61), but only TaskType uses it (task-type.routes.ts:13).
- Impact: A cosmetic rename such as "Feed" → "Poultry Feed" silently zeroes the feed analytics and reclassifies alerts. Renaming the "Kilogram" unit stops every new item being created in KG. Renaming the "Salary" category makes the next payout upsert a second `SALARY` category, which splits wage reporting. Nothing errors.
- Direction: Make `code` immutable for every lookup (`stableCode` on all four), or stop referring to lookup rows by literal code in application logic.

### D-3: Polymorphic references have no FK, and some writers skip the existence check
- Severity: high
- Location: schema.prisma:1114-1117 (StockTransfer `from/to_location_type/id`), :1075-1078 (StockLedger `location_*`, `ref_type`/`ref_id`), :1262-1263 (Payment `ref_type`/`ref_id`), :1279-1280 (PaymentInstrument `owner_type`/`owner_id`), :1463 (Alerts `related_id`)
- Evidence:
  - transfer.service.ts:46 checks only the source: `await assertLocationExists(tx, data.from_location_type, data.from_location_id);`. The destination `to_location_id` is never checked, and transfer.validator.ts:11 accepts any UUID. The ledger IN row is written to that location (transfer.service.ts:84-92). Downstream, lib/stock-balance.ts:105 falls back to `?? "Unknown"` for unresolved location ids.
  - payment-instrument.service.ts:34-46 stores `owner_id` unchecked. The validator comment at payment-instrument.validator.ts:9-12 says "Not validated against the target table".
  - `RefType.PURCHASE` on StockLedger points at a **PurchaseItem** id (purchase.service.ts:154 `ref_id: purchaseItem.id`), while `PaymentRefType.PURCHASE` on Payment points at a **Purchase** id (payment.service.ts:49-53). The same label means different tables.
  - Payment is the only writer that checks: payment.service.ts:29-30 calls this check "the only thing standing between a typo and an orphaned payment".
- Impact: A mistyped or stale destination id moves stock out of a real location into one that does not exist. The stock leaves every balance and cannot be transferred back through the API. Instruments can belong to owners that do not exist. Any join on `ref_type`/`ref_id` has to know the per-table granularity, which the schema does not record.
- Direction: Use real nullable FKs per target (e.g. `from_warehouse_id`/`from_house_id`, which the original StockTransfer had per migration 20260823140312:31-32), or at least validate both endpoints. Give `ref_id` one meaning per `ref_type`.

### D-4: Item sales never leave stock; the schema has nowhere to record it
- Severity: high
- Location: schema.prisma:1182-1196 (SaleItem: no `base_quantity`, no location); :158-166 (StockReason has no SALE); :174-179 (RefType has no SALE); src/services/sale.service.ts:82-125
- Evidence: `SaleService.create` writes `Sale` and `SaleItem` and nothing else. It makes no `StockLedger` OUT entry and no unit conversion. docs/api.md:897 scopes Sale as "regular items — feed surplus, culls, manure, etc.", so stocked items (feed) are expected to be sold. Purchase (purchase.service.ts:149-160) and Consumption (consumption.service.ts:107-120) both post ledger entries. Sale is the only movement of goods that does not.
- Impact: Selling surplus feed leaves warehouse and house balances overstated. Transfers and consumption checks (transfer.service.ts:48-58, consumption.service.ts:79-86) then allow drawing stock that is gone, and low-stock alerts don't fire.
- Direction: Give SaleItem `base_quantity` and a source location, and add a SALE reason/ref so a sale posts a ledger OUT. Alternatively, restrict Sale to non-stocked items explicitly.

### D-5: "Happens once" invariants rest on check-then-act outside a transaction, and the DB unique sits on the wrong side
- Severity: high
- Location: schema.prisma:1526 (`IngestedSale.bird_sale_id @unique`); :1263, :1274 (Payment `ref_id`, non-unique index only); src/services/ingest.service.ts:69-108; src/services/payroll-payout.service.ts:131-136, :148-220
- Evidence:
  - `IngestService.confirm` reads `row.status !== "PENDING"` (:72) and then calls `BirdSaleService.create` (:76), which commits its own transaction. Only after that does it update the staging row (:99). Two concurrent confirms both pass the check and both create a BirdSale, each decrementing BatchHouseBalance. The `@unique` on `bird_sale_id` only makes the second *staging update* fail, after its BirdSale is already committed.
  - `markPaid` checks `payout.status === "CONFIRMED"` (:132-136) before `prisma.$transaction` opens (:148). A double submit writes two SALARY expenses and two `Payment` rows with `ref_type: "PAYROLL", ref_id: payout.id` (:195-207). Nothing in the DB says a payout has one cash row.
- Impact: Revenue and bird counts can be duplicated for one weighing session. Salary cost and cash outflow can be duplicated for one payout. Both are real money figures.
- Direction: Move the status check inside the transaction with a conditional update (`WHERE status = 'PENDING'`). Add a DB uniqueness that encodes the rule, e.g. a partial unique on Payment `(ref_id) WHERE ref_type = 'PAYROLL'`.

### D-6: BatchHouseBalance cache has no non-negative guard and a fourth undocumented writer
- Severity: medium
- Location: schema.prisma:708-723 (comment :716-719: "the only three things that can change it"); src/services/batch.service.ts:146; src/services/mortality-log.service.ts:32-56; src/services/bird-sale.service.ts:97-136; src/services/batch-house-allocation.service.ts:51-62
- Evidence: Every decrement is read-check-update (`if (!balance || balance.quantity < data.count_died)`, then `decrement`) under READ COMMITTED. lib/stock-balance.ts:112 itself notes the "not serializable under Postgres READ COMMITTED" risk. No `CHECK (quantity >= 0)` exists. Also, `BatchService.close` with `force` runs `tx.batchHouseBalance.updateMany({ where: { batch_id: id }, data: { quantity: 0 } })` (:146) without writing any allocation, mortality or sale event.
- Impact: Concurrent mortality, sale or move writes can drive the cached count negative. After a forced close, the cache can no longer be rebuilt from the event tables, which is exactly the drift the schema comment warns about.
- Direction: Add `CHECK (quantity >= 0)` (or decrement with a `quantity >= n` predicate). Make force-close write an ADJUSTMENT allocation row instead of zeroing out of band.

### D-7: WeightRecords uniqueness does not enforce what it claims
- Severity: medium
- Location: schema.prisma:1034 (`batch_id String?`), :1039 (`date DateTime`), :1046 (`@@unique([batch_id, house_id, date])`); src/services/weight-record.service.ts:26-27; src/validators/weight-record.validator.ts:5, :9
- Evidence: The service comment says a "second sample logged for the same batch+house+day is a conflict". However:
  - `batch_id` is optional (validator :5). Postgres treats NULLs as distinct, so rows without a batch are never deduplicated.
  - `date` is a full timestamp (`z.coerce.date()`, no `@db.Date`), so 08:00 and 08:01 on the same day are different keys.
- Impact: Duplicate weight samples per house-day get through, which skews growth curves and average-weight analytics.
- Direction: Store `date` as `@db.Date` (or truncate it), and either make `batch_id` required or use `NULLS NOT DISTINCT` / a partial unique for the null case.

### D-8: `is_unit_tracked` is documented as a gate but is not enforced
- Severity: medium
- Location: schema.prisma:760-764 ("Gates bind() and TransferService.create() so the two mechanisms can't be mixed"); :946 (Consumption `stock_unit_id`); src/services/transfer.service.ts:24-101; src/services/consumption.service.ts:49-86; src/services/item.service.ts:115
- Evidence: `grep is_unit_tracked src` finds only stock-unit.service.ts:87 (bind) and item CRUD. TransferService never reads it. Consumption accepts a `stock_unit_id` for any item and never checks that the unit's `purchase_item.item_id` equals `data.item_id`. Item update can flip `is_unit_tracked` after units or ledger rows exist (item.service.ts:115).
- Impact: Coded items can be moved through the aggregate ledger, and a draw can record vaccine bottle X as consumption of item Y. Either way the two stock mechanisms disagree about the same item.
- Direction: Enforce the flag in Transfer and Consumption and freeze it once history exists. Have StockUnit carry `item_id` so a composite FK `(stock_unit_id, item_id)` can enforce item agreement.

### D-9: Soft-delete is display-only, and hard deletes contradict the documented rule
- Severity: medium
- Location: `is_active` at schema.prisma:319, :330, :360, :387, :398, :443, :465, :578, :593, :637, :759, :1287; docs/system-design-arc.md:146 ("Nothing gets hard-deleted"); hard deletes at house.service.ts:217, warehouse.service.ts:81, item.service.ts:166, :233, payment-instrument.service.ts:92, asset.service.ts:62, stock-unit.service.ts:203-206, task.service.ts:101, employee-role.service.ts:87, organization.service.ts:78, lookup-factory.ts:125
- Evidence:
  - No write path checks `is_active` on what it references. A grep across consumption, purchase, sale, bird-sale, mortality-log, batch-house-allocation, expense, batch and employee services finds no `is_active` predicate. A deactivated Item, House, Supplier, Customer, Unit, category or EmployeeRole can still be used in new records.
  - Most hard deletes are guarded by counting children, but:
    - house.service.ts:185-203 counts ten relations and omits `taskAssignments`. Those rows are `ON DELETE SET NULL` (migration 20260903094512:110), so deleting a house silently turns its tasks into "not house-specific".
    - stock-unit.service.ts:203-206 `deleteMany`s the unit's StockHouseAllocation movement history.
  - Doctors (:601) and Warehouses (:1134) have no soft-delete flag at all.
- Impact: "Deactivate" does not stop new data from pointing at retired entities. History can still be erased through the listed paths, contrary to the design doc.
- Direction: Pick one policy per model, reject inactive references on create, and include every relation in delete guards (or let RESTRICT FKs do it, as lookup-factory.ts:116-130 does).

### D-10: Employment state is stored twice and one endpoint desyncs it
- Severity: medium
- Location: schema.prisma:465 (`Profiles.is_active`), :546, :550 (`employment_status`, `terminated_at`); src/services/employee.service.ts:211-214, :374-378; src/routes/employee.routes.ts:32-33
- Evidence: The service itself says "TERMINATED and is_active are two halves of one fact, and only terminate()/reinstate() move both" (:211-212). But `setActive` (:374-378), exposed as `POST /:id/reactivate` and `/:id/deactivate`, flips only `profiles.is_active`. Reactivating a TERMINATED employee therefore leaves `employment_status = TERMINATED` and `terminated_at` set, while every `profile.is_active` filter (alert.service.ts:123, analytics.service.ts:26, employee.service.ts:85) now counts them as active staff.
- Impact: Terminated staff reappear in headcount and alerts while payroll still blocks them. Active staff can also be "deactivated" with no termination date.
- Direction: Derive one flag from the other, or route activate/deactivate through terminate/reinstate.

### D-11: FK delete actions contradict the history-preservation intent
- Severity: medium
- Location: schema.prisma:889-890 (StockHouseAllocation `house_id`; migration 20260831173243 sets `ON DELETE SET NULL`); :691-694 (BatchHouseAllocation from/to house, `onDelete: SetNull`); :1089, :1091, :1093 (InventoryAdjustment `onDelete: Cascade` from Item, Warehouse, House); :690 (BatchHouseAllocation `batch` Cascade, while every sibling batch relation is Restrict)
- Evidence: On StockHouseAllocation, `house_id` NULL *means* "returned to the warehouse" (schema :889, `type` derived from it at stock-unit.service.ts:156-157). A house delete would rewrite every allocation into an apparent return. On BatchHouseAllocation, NULL `from`/`to` encodes direction for ADJUSTMENT rows (batch-house-allocation.service.ts:25-27). InventoryAdjustment is an audit record, yet it is declared to cascade-delete with its item, warehouse or house. Today only the app-side count guards stop this (house.service.ts:185-213, warehouse.service.ts:64-81, item.service.ts:140-166), and they count before deleting without a transaction.
- Impact: The DB is configured to destroy or mis-state history whenever a guard is missed or a delete is run by hand. The FK action is the opposite of the documented intent.
- Direction: Use `onDelete: Restrict` on these relations so the DB enforces what the guards try to.

### D-12: Simple row-level invariants live only in app code where a CHECK or partial unique would do
- Severity: medium
- Location: (each is a one-line DB constraint today enforced only in a service or validator)
  - schema.prisma:535-538 Employees reference: employee XOR outside person ("Enforced in the service")
  - :1409-1414 EmployeeTaskAssignment `house_id` XOR `location_note` ("Enforced in the service")
  - :1304-1305, :1314, :1316 PerformanceScoreEntry: OTHER ⇒ `approved_by_id`, points ≤ -4 ⇒ `notice_doc_url`, VOIDED ⇒ `void_reason`
  - :1347-1349, :1365 EmployeePayoutAccount: at most one row with `active_to IS NULL` per employee. employee-payout-account.service.ts:61-66 closes then inserts under READ COMMITTED, so two concurrent creates can leave two active accounts.
  - :1328 PayrollRecord.month "normalized to first-of-month" (normalized in UTC at payroll-record.service.ts:98-100; the column is a timestamp, not `@db.Date`)
  - :1096 InventoryAdjustment `adjustment_quantity = quantity_after - quantity_before`, and exactly one of warehouse/house (inventory-adjustment.service.ts:62-63: "the validator only requires at least one, not exactly one")
  - :1208-1210 BirdSale `male_count + female_count = birds_count` (bird-sale.validator.ts:28-34)
  - alert.service.ts:24-33 "One ACTIVE alert per (type, related_id)" via find-then-create
  - positive quantities and amounts on every ledger, sale or purchase line (validator-only)
- Evidence: As stated in the location list. No CHECK or partial index exists in any migration.
- Impact: Every new code path, script or manual SQL fix has to re-implement these rules. Some of them (payout account, alert dedup) already have race windows.
- Direction: Add CHECK constraints and partial unique indexes via raw SQL in a migration for the cheap ones.

### D-13: Payment direction is free-form, and payroll expenses can be paid twice
- Severity: medium
- Location: schema.prisma:1261-1263 (`direction`, `ref_type`, `ref_id`); src/validators/payment.validator.ts:19, :23; src/services/payment.service.ts:56-58, :128-158; src/services/payroll-payout.service.ts:159-169, :195-207
- Evidence:
  - `direction` is accepted independently of `ref_type`. An INCOMING payment against a PURCHASE or an OUTGOING one against a SALE passes. Instrument balances ignore `direction` entirely and use only `from`/`to` (payment-instrument.service.ts:106-108), so the column is redundant and unvalidated.
  - `markPaid` writes a SALARY `Expense` *and* a `Payment` with `ref_type: "PAYROLL"`. The Expense is linked to the payout only by free text (`remarks: \`Wage on payout ${payout.id}\``, :169). `owedForRef("EXPENSE")` treats any Expense as wholly unpaid (:56-58), so `POST /payments` against a salary Expense succeeds and records the wage leaving the wallet a second time.
- Impact: Cash ledger direction can contradict the document it settles, and salary cash outflow can be double-counted.
- Direction: Derive `direction` from `ref_type` (or validate it). Give Expense a real FK to the payout, or mark payroll expenses non-payable.

### D-14: InventoryAdjustment trusts client-supplied stock and its reason is free text
- Severity: medium
- Location: schema.prisma:1094-1097 (`quantity_before`, `quantity_after`, `adjustment_quantity`, `reason String`); :158-166 (StockReason WASTAGE/EXPIRED); src/services/inventory-adjustment.service.ts:29-74; src/services/analytics.service.ts:653-660
- Evidence: `quantity_before` comes from the client (validator: `z.coerce.number().nonnegative()`) and is never compared with `getItemLocationBalance`. The ledger posts `after - before`, so a wrong "before" posts a wrong delta. `reason` is free text, while the ledger row is always `reason: "ADJUSTMENT"` (:57). Nothing ever writes `WASTAGE`/`EXPIRED`; analytics.service.ts:653-656 admits `wastageByCategory` "will read empty until one does".
- Impact: Stock counts can't be trusted after an adjustment, the stored "before" figure is not an audit fact, and the wastage report is permanently zero.
- Direction: Compute `quantity_before` server-side from the ledger, and make `reason` an enum that maps onto StockReason.

### D-15: AuditLog is effectively unused, despite the docs relying on it
- Severity: medium
- Location: schema.prisma:1436-1450; docs/system-design-arc.md:140-145; docs/full-schema-analysis.md:45-49; src/services/employee.service.ts:268
- Evidence: The only `auditLog.create` in `src` is employee.service.ts:268, for `reference_salary` changes. The docs say AuditLog "covers the mutable tables (`Item`, `Batches`, `Employees`, `StockUnit` status/location changes, etc.)" and recommend middleware. Mutations like stock-unit.service.ts:183-186 (`setStatus`, "no transition guards"), batch close/update, item update (including `is_unit_tracked`) and house phase changes go unaudited.
- Impact: The schema promises an audit trail it does not have. Free status edits on coded stock and batches leave no history.
- Direction: Either wire the generic writer the docs describe, or shrink AuditLog to the one audited field and correct the docs.

### D-16: String columns that should be enums
- Severity: low
- Location: schema.prisma:1525 (`IngestedSale.status String @default("PENDING") // PENDING | CONFIRMED | DISMISSED`), :1521 (`portion String // "main" | "cull"`), :1513 (`source String @default("poultryscale")`), :1097 (InventoryAdjustment.reason, see D-14), :974 vs :996 (Medications.dosage `String`, Vaccinations.dosage `Int`)
- Evidence: The value sets are fixed and hard-coded in ingest.service.ts:23, :72, :102, :122 and ingest.validator.ts:45. The DB accepts any string.
- Impact: Typos are stored silently, and the dosage type mismatch prevents treating the two treatment tables uniformly.
- Direction: Convert these to enums, and pick one dosage representation.

### D-17: Type and precision choices
- Severity: low
- Location: schema.prisma:666 (`init_chicks_avg_wt Float`, while WeightRecords.average_wt_grams is `Decimal(10,2)` at :1038 and the unit is not in the name); :515, :577, :609 (`rating Float? @default(0)`: nullable *and* defaulted, so "unrated" and "0" are indistinguishable); :1074 (`StockLedger.unit_cost Decimal(10,2)`); :1328 (`PayrollRecord.month DateTime`); :1465-1466 (`Alerts.issued_at/resolved_at @db.Date`)
- Evidence: `unit_cost` is written as `total_price / base_quantity` (purchase.service.ts:158), which rounds to 2 dp per base unit (e.g. per DOSE). It is never read: lib/stock-value.ts:5-7 even claims it is "never populated" and recomputes from PurchaseItem. Alerts store a `@db.Date` while the code assigns `new Date()` (alert.service.ts:39, :286), which drops the time of day.
- Impact: These cause minor precision and semantic loss, plus a written-but-dead column.
- Direction: Use Decimal for weights, a non-null rating or no default, drop or widen `unit_cost`, `@db.Date` for payroll month, and timestamps for alerts.

### D-18: Dead or redundant schema surface
- Severity: low
- Location: schema.prisma:55-60 (`enum ContactMethods`: no column uses it; created in init migration :11); :260, :1389 (`PayoutMethod.CASH`, `receipt_doc_url`: CASH barred by employee-payout-account.validator.ts:4-7, and `receipt_doc_url` has 0 references in src); :464 (`Profiles.role`: set to the subtype at every create, e.g. customer.service.ts:43, and read by no auth code); :460 (`mobile @unique` plus one Profile per role means one person cannot be both supplier and customer); :609 (`Doctors.rating`: no writer)
- Evidence: Grep counts given in the location list.
- Impact: This adds noise and misleads readers, e.g. `receipt_doc_url`'s comment "required when method = CASH" describes a flow that no longer exists.
- Direction: Drop the unused enum, value and columns. Derive role from the subtype or drop it.

### D-19: Timestamp columns are inconsistent on mutable models
- Severity: low
- Location: no `updated_at` on models that are updated in place: StockUnit (:857, status via stock-unit.service.ts:186), Asset (:908, setStatus), PaymentInstrument (:1277, update), EmployeePayoutAccount (:1350, `active_to`), PayrollPayout (:1376, markPaid/fail), PerformanceScoreEntry (:1298, void/dispute/ack at performance-score-entry.service.ts:158-185), Warehouses (:1134, rename), Device (:1478), Organization (:1143). No `created_at` on BatchFeedingProgram (:1049), ItemOrganization (:1152), SupplierSupplyLink (:405) or BatchHouseBalance (:708).
- Evidence: As listed.
- Impact: There is no "last changed" signal for incremental mobile sync or for debugging. This compounds D-15.
- Direction: Add `updated_at @updatedAt` to every model with an update path.

### D-20: Required-vs-optional and duplicated-value mismatches
- Severity: low
- Location:
  - schema.prisma:803 `Purchase.warehouse_id String?`, but purchase.validator.ts:39 requires it. A null would post a location-less ledger IN that is invisible to location balances (stock-balance.ts:54-55).
  - :1241, :1245 Expense `cost_type DIRECT` with no `batch_id` is accepted (expense.validator.ts:9-11). Batch P&L reads `{ batch_id, cost_type: "DIRECT" }` (analytics.service.ts:157), so such costs vanish.
  - :634 `Houses.number Int` not unique; :1136 `Warehouses.name` not unique.
  - :971-973, :993-995 Medications/Vaccinations duplicate `medicine_name`/`vaccine_name` alongside `consumption_id`, with no check that the consumption's item or batch matches (medication.service.ts:29-30, vaccination.service.ts:32-33 pass it through).
  - :913-914 `Asset.purchase_cost` and `purchase_date` are client-entered (asset.validator.ts:9-10) instead of derived from the linked StockUnit → PurchaseItem.
- Evidence: As listed.
- Impact: These are small correctness gaps that let inconsistent rows in.
- Direction: Align nullability with the validators, and add CHECK or unique where the rule is fixed.

### D-21: Naming inconsistencies (grouped)
- Severity: low
- Location: schema.prisma, throughout
- Evidence:
  - Model names mix plural (`Profiles`, `Employees`, `Houses`, `Batches`, `Tasks`, `Alerts`, `Warehouses`, `MortalityLog` vs `WeightRecords`) and singular (`Item`, `Purchase`, `Sale`, `Payment`, `StockUnit`).
  - Enums mix plural (`BirdBreeds`, `AlertTypes`, `AlertLevels`, `TimePeriods`, `ContactMethods`, `SupplierRoleNames`) and singular.
  - Money totals are named `total` (Sale :1172) vs `total_amount` (Purchase :812, BirdSale :1218).
  - Event times are named `date`, `sale_date`, `purchase_date`, `recorded_at`, `occurred_at`, `computed_at`.
  - `role` means a `UserRole` enum on Profiles (:464), an EmployeeRole code on Employees (:509) and a `SupplierRoleNames` on Suppliers (:590).
  - The enum for payment direction is named `PaymentType` (:206).
  - `ExpenseCategoryLookup` vs `ItemCategory` / `SupplierSupplyCategory`.
  - camelCase relation fields (`categoryRef`, `unitRef`, `roleRef`) sit among snake_case columns.
  - `Organization.label_name` vs `label` everywhere else.
  - Enum value spelling `PAKISTHANI` (:93).
- Impact: This is cognitive overhead and invites wrong joins; it has no functional effect.
- Direction: Normalize naming in a single pass when the schema is next migrated.
