# Findings 02 — Performance & query patterns
- Date: 2026-10-06
- Commit: server@df7bc95
- Files analyzed: prisma/schema.prisma; prisma/migrations/*/migration.sql (all 30; no raw-SQL partial indexes, no CHECK constraints, no `$queryRaw`/`$executeRaw` anywhere in src/); src/lib/{db,pagination,stock-balance,stock-value,unit-conversion,house-turnaround,alert-scan-loop,lookup-factory,current-actor}.ts; src/services/{analytics,alert,payment,payment-instrument,payroll-payout,payroll-record,performance-score-entry,employee,ingest,bird-sale,sale,purchase,consumption,transfer,inventory-adjustment,stock-ledger,stock-unit,stock-house-allocation,batch,batch-house-allocation,batch-house-balance,mortality-log,house,warehouse,item,task-assignment,expense,environment-record,weight-record,device,audit-log,medication,vaccination,asset,asset-depreciation,batch-feeding-program,employee-payout-account,employee-role,task,admin,customer,supplier,doctor,organization}.service.ts; src/routes/{alert,ingest,payment,item,employee,sale,bird-sale,analytics,expense-category,item-category,supplier-supply-category,task-type,unit}.routes.ts; src/controllers/{ingest,alert,payment}.controller.ts; src/validators/{analytics,ingest}.validator.ts

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 2 |
| Medium | 9 |
| Low | 11 |
| **Total** | **22** |

At one farm, nothing here causes slow queries today. The two **high** findings are money and stock writes that can be applied twice, because a guard sits outside its transaction. The **medium** findings are missing indexes and unpaginated reads on tables that keep growing: StockLedger, Consumption, PurchaseItem, Payment, IngestedSale and Alerts. They will start to cost time and connections as years of data build up. Pagination is applied the same way everywhere (`toSkipTake`, max 100) on almost every list endpoint, and the main stock-balance and analytics paths already use `groupBy`/`aggregate`, not per-item loops.

Index baseline used below (from migrations, which match the schema): an FK column is indexed only where listed in `@@index`/`@@unique`/`@unique`/`@@id`. Postgres does not index FKs automatically.

---

### P-1: Confirming an ingested sale is not atomic, so it can create two BirdSales and decrement the bird balance twice
- Severity: high
- Location: src/services/ingest.service.ts:69-109
- Evidence:
  ```ts
  const row = await prisma.ingestedSale.findUnique({ where: { id } });   // :70
  if (row.status !== "PENDING") throw ...                                 // :72
  const birdSale = await BirdSaleService.create({ ... });                 // :76  (own $transaction, commits)
  await prisma.ingestedSale.update({ where: { id }, data: { status: "CONFIRMED", bird_sale_id: birdSale!.id, ... } }); // :99
  ```
  The PENDING check, the BirdSale transaction (`bird-sale.service.ts:96-140`, which decrements `BatchHouseBalance`) and the staging-row update are three separate units. Two concurrent confirms, or a double-click, both pass the `PENDING` check and both commit a BirdSale and a balance decrement. Only the second `ingestedSale.update` fails, on `IngestedSale.bird_sale_id @unique` (`schema.prisma:1526`), and by then the duplicate sale is already committed. The same thing happens if the process dies between :76 and :99: the BirdSale exists, but the row is still PENDING and can be confirmed again.
- Impact: duplicate revenue rows and an undercounted live-bird balance (which also drives house CLEANING transitions). Nothing reconciles this automatically.
- Direction: run the status claim (conditional `updateMany where status = PENDING`), the BirdSale create and the link in one transaction. BirdSaleService needs to accept a `tx` for this.

### P-2: Payout `markPaid` checks status outside its transaction, so a double submit writes Expense and Payment twice
- Severity: high
- Location: src/services/payroll-payout.service.ts:131-221
- Evidence:
  ```ts
  const payout = await prisma.payrollPayout.findUnique({ where: { id } });   // :132
  if (payout.status === "CONFIRMED") throw ...                              // :134
  ...
  return prisma.$transaction(async (tx) => {                                 // :148
      await tx.expense.create(...)        // :159 wage
      await tx.expense.create(...)        // :179 fee
      await tx.payment.create(...)        // :197 cash out
      return tx.payrollPayout.update({ where: { id }, data: { status: "CONFIRMED", ... } }); // :211
  ```
  The transaction makes the four writes atomic, but the "not already CONFIRMED" guard is read before the transaction and is never re-checked inside it. The final `update where: { id }` has no status condition. The comment at :195-196 assumes "a payout can only be confirmed once", and that is not enforced.
- Impact: two concurrent or retried calls produce two SALARY expenses, two fee expenses and two outgoing Payments, which double-counts wage cost and lowers the instrument's cash balance by twice the payout.
- Direction: claim the row inside the transaction with a conditional update (`updateMany where { id, status: { not: "CONFIRMED" } }`, require count = 1) before writing the ledger rows.

### P-3: Check-then-write balance guards don't hold under READ COMMITTED
- Severity: medium
- Location:
  - src/services/payment.service.ts:127-135 (overpayment guard)
  - src/services/mortality-log.service.ts:32-56
  - src/services/bird-sale.service.ts:97-136
  - src/services/batch-house-allocation.service.ts:51-62
  - src/services/consumption.service.ts:82-87
  - src/services/transfer.service.ts:48-58
- Evidence: each one reads a balance with a plain `findUnique`/`aggregate`/`groupBy` inside an interactive `$transaction` (Prisma's default isolation is READ COMMITTED) and writes based on that read:
  ```ts
  const balance = await tx.batchHouseBalance.findUnique({ where: { batch_id_house_id: ... } });
  if (!balance || balance.quantity < data.count_died) throw ...
  ...
  await tx.batchHouseBalance.update({ where: { id: balance.id }, data: { quantity: { decrement: data.count_died } } });
  ```
  The docblock on `PaymentService.create` (payment.service.ts:121-124) says the transaction stops "two concurrent payments [from] both pass[ing] the check". It doesn't: neither the `aggregate` nor the `findUnique` takes a lock. `getItemLocationBalance` already acknowledges this risk for stock (stock-balance.ts:110-114). No migration adds a `CHECK (quantity >= 0)`, so nothing at the database level stops a negative balance.
- Impact: concurrent offline-sync replays from several field devices can push `BatchHouseBalance.quantity` below zero, overpay a Sale/BirdSale/Purchase (which breaks the "outstanding >= 0" invariant that `SaleService.summary` relies on, sale.service.ts:45-49), or overdraw house stock. The probability is low at one farm, but nothing detects it afterwards.
- Direction: use conditional decrements (`updateMany ... where quantity >= n`, check the count), `SELECT ... FOR UPDATE` on the balance row, or a CHECK constraint.

### P-4: `PurchaseItem.purchase_id` FK has no index, and every purchase read joins on it
- Severity: medium
- Location: prisma/schema.prisma:824-851 (indexes only `item_id`, `batch_id` at :849-850); used by src/services/purchase.service.ts:14, :54, :58-62, :70; src/services/analytics.service.ts:458-461
- Evidence:
  ```ts
  const include = { items: { include: { item: true } }, supplier: true } as const;   // purchase.service.ts:14
  ...(query.item_category !== undefined && { items: { some: { item: { category: query.item_category } } } }),  // :54
  prisma.purchaseItem.findMany({ where: { purchase: { purchase_date: window } }, ... })  // analytics.service.ts:459
  ```
  The init migration creates `PurchaseItem_item_id_idx` and `PurchaseItem_batch_id_idx` only. Every list page (up to 100 purchases), `getById`, `create`'s re-read (:164), the category `some` filter and `purchasesByCategory` resolve PurchaseItem by `purchase_id` with a sequential scan.
- Impact: PurchaseItem grows with every purchase line, and these are the purchases list and dashboard endpoints. The cost rises linearly with all-time purchase history.
- Direction: add `@@index([purchase_id])`.

### P-5: Payment instrument FKs have no index, and the financial dashboard fans out three queries per instrument
- Severity: medium
- Location: prisma/schema.prisma:1257-1275 (only `@@index([ref_type, ref_id])`); src/services/payment-instrument.service.ts:102-109; src/services/analytics.service.ts:226-228; src/services/payment.service.ts:97-110; src/services/payment-instrument.service.ts:79-82
- Evidence:
  ```ts
  const balances = await Promise.all(
      instruments.map((inst) => PaymentInstrumentService.getBalance(inst.id)),   // analytics.service.ts:226
  );
  // getBalance:
  const instrument = await prisma.paymentInstrument.findUnique({ where: { id } });          // :103 (redundant re-read)
  prisma.payment.aggregate({ where: { to_instrument_id: id }, _sum: { amount: true } }),    // :107
  prisma.payment.aggregate({ where: { from_instrument_id: id }, _sum: { amount: true } }),  // :108
  ```
  `from_instrument_id` and `to_instrument_id` are unindexed, so each aggregate scans all of Payment: 2 full scans plus 1 findUnique per active instrument, on every load of the financial dashboard. `PaymentService.getAll` filters `OR: [{from_instrument_id}, {to_instrument_id}]` (:97-101) and sorts by unindexed `payment_date` (:107). `remove` counts both relations (:81).
- Impact: Payment is an append-only ledger that grows without bound (every sale, purchase, expense and payout payment), and the scans are repeated N times per dashboard view.
- Direction: index both instrument FKs. Compute every instrument's balance with two `groupBy` calls (by `to_instrument_id` and by `from_instrument_id`), not one call per instrument.

### P-6: Per-location stock queries filter StockLedger on `(location_type, location_id)` with no index
- Severity: medium
- Location: src/lib/stock-balance.ts:36-40 (`getLocationStock`), :67-71 (`getStockByLocation`); callers src/services/house.service.ts:121, :207-209; src/services/warehouse.service.ts:34, :71; schema prisma/schema.prisma:1082-1083
- Evidence:
  ```ts
  const sums = await prisma.stockLedger.groupBy({
      by: ["item_id", "direction"],
      where: { location_type, location_id },          // stock-balance.ts:38
      _sum: { quantity: true },
  });
  ```
  StockLedger indexes are `(item_id, occurred_at)` and `(ref_type, ref_id)`. Nothing leads with `location_type`/`location_id`, so each house or warehouse stock view, and each house/warehouse delete-guard count, scans the whole ledger. `getItemLocationBalance` (stock-balance.ts:121-125, called inside the Consumption and Transfer write transactions) can at least narrow by `item_id` first.
- Impact: StockLedger is the fastest-growing table: every purchase line, consumption and transfer (2 rows) adds to it. House and warehouse stock screens get slower with each year of history.
- Direction: add `@@index([location_type, location_id, item_id])`, which also serves `getItemLocationBalance`.

### P-7: Analytics trend endpoints filter only on date, with no usable index, and bucket rows in JS
- Severity: medium
- Location: src/services/analytics.service.ts:256-259 (MortalityLog.date), :280-283 (Consumption.date), :309-312 (BirdSale.sale_date), :458-461 (Purchase.purchase_date via join), :481-484, :586-589 (StockLedger.occurred_at), :611-614, :633-636, :659-662
- Evidence:
  ```ts
  const rows = await prisma.stockLedger.findMany({
      where: { occurred_at: window },                         // :587, window up to 365 days
      select: { item_id: true, quantity: true, direction: true, occurred_at: true },
  });
  ... for (const row of rows) { const dateKey = row.occurred_at.toISOString().slice(0, 10); ... }
  ```
  Every date column involved is indexed only as the second key of a composite (`StockLedger(item_id, occurred_at)`, `Consumption(house_id, date)`, `MortalityLog(house_id, date)`, `BirdSale(batch_id, sale_date)`, `Purchase(supplier_id, purchase_date)`, `Expense(batch_id, date)`), so a date-only range can't use any of them. `trendsQuerySchema` allows `days` up to 365 (analytics.validator.ts:4), and each call pulls every row in that window into Node, then sums Decimals per day or category. The code comments explain the in-memory bucketing as avoiding Prisma's `groupBy` on full DateTime precision. That is a Prisma limitation that raw SQL with `date_trunc` doesn't have.
- Impact: StockLedger and Consumption are high-volume (daily feed per house). A 365-day trend reads and serialises tens of thousands of rows per chart, and the analytics page loads several of these charts together. This is acceptable today and grows linearly.
- Direction: add date-leading indexes on StockLedger and Consumption (the low-volume tables can wait), and do the day/category bucketing in SQL (`$queryRaw` with `date_trunc ... GROUP BY`).

### P-8: The alert scan issues one or two queries per entity in sequential loops, Alerts has no index for its dedupe lookup, and an on-demand scan can race the timer
- Severity: medium
- Location: src/services/alert.service.ts:27-47, :78-97, :121-136, :142-164, :106-113, :295-305; src/routes/alert.routes.ts:9; src/lib/alert-scan-loop.ts:23-29; prisma/schema.prisma:1456-1472
- Evidence:
  ```ts
  for (const batch of runningBatches) {
      const deaths = await prisma.mortalityLog.aggregate({ where: { batch_id: batch.id, date: { gte: since } }, ... });  // :82
  for (const employee of employees) {
      if (!employee.profile.is_active) continue;               // JS filter after loading all employees+profiles
      const existing = await prisma.payrollRecord.findUnique(...);          // :124
  for (const employee of employees) {
      const entries = await prisma.performanceScoreEntry.findMany(...);     // :145, then JS reduce of points
  // upsertActiveAlert, called sequentially per hit:
  const existing = await prisma.alerts.findFirst({ where: { type, related_id, status: "ACTIVE" } });  // :29
  ```
  `Alerts` has no index except PK and `idempotency_key`, so each `upsertActiveAlert` is a sequential scan, run once per low-stock item, expiring lot, employee and so on, one after another. `checkPayrollDue` and `checkNegativePerformancePatterns` load every employee, active or not, and filter in JS. The dedupe is check-then-insert with no unique constraint behind it. `POST /alerts/scan` (alert.routes.ts:9) calls `runScan()` directly and skips the loop's `running` flag (alert-scan-loop.ts:23-29), so a manual scan overlapping a timed scan can insert duplicate ACTIVE alerts. `AlertService.getAll` also sorts by unindexed `created_at` and filters on unindexed `status`.
- Impact: this is background work, so users only see it through `POST /alerts/scan` latency. Query count is O(batches + employees×2 + alerts×2) per run, repeated every `ALERT_SCAN_INTERVAL_MS`, and Alerts keeps growing because resolved alerts are re-raised as new rows.
- Direction: replace the per-row loops with one `groupBy` per check, add `@@index([type, related_id, status])` (or a partial unique on ACTIVE), and route the manual scan through the same in-process lock.

### P-9: The ingested-sales list has no pagination and returns the raw device payload JSON
- Severity: medium
- Location: src/services/ingest.service.ts:55-64; src/validators/ingest.validator.ts:44-46; src/controllers/ingest.controller.ts:25-30
- Evidence:
  ```ts
  async list(status?: string) {
      return prisma.ingestedSale.findMany({
          where: { ...(status !== undefined && { status }) },
          orderBy: { received_at: "desc" },
          include: { recorded_by: {...}, device: {...} },     // no select -> includes `payload Json`
      });
  ```
  `listIngestedQuerySchema` accepts only `status`, with no page or limit. This is the only list endpoint in the codebase that doesn't use `toSkipTake`. With no status filter, or with `CONFIRMED`/`DISMISSED`, it returns the full all-time history, including each session's complete device payload.
- Impact: IngestedSale grows with every weighing session from every paired phone and is never deleted ("Never deletes", :112). Response size grows without bound. PENDING-only reads stay small and use `IngestedSale_status_received_at_idx`.
- Direction: paginate like every other list, and drop `payload` from the list projection (keep it on `getById`).

### P-10: Sales "due" figures send all-time ID lists and per-ref totals to the client
- Severity: medium
- Location: src/services/sale.service.ts:50-66; src/services/bird-sale.service.ts:44-57; src/services/payment.service.ts:166-176 (served at `GET /payments/outstanding`, src/routes/payment.routes.ts:23-27)
- Evidence:
  ```ts
  prisma.sale.findMany({ where, select: { id: true } }),       // sale.service.ts:61 -- every matching sale id
  const paid = await prisma.payment.aggregate({
      where: { ref_type: "SALE", ref_id: { in: ids.map((row) => row.id) } },   // :64
  ```
  and
  ```ts
  /** ... Deliberately unpaginated: the Sales tables' Due column needs all of them ... */
  const grouped = await prisma.payment.groupBy({ by: ["ref_id"], where: { ref_type }, _sum: { amount: true } });  // payment.service.ts:167
  ```
  With no filter, the summary endpoints fetch every Sale/BirdSale id ever recorded, then bind all of them as parameters in an `IN` list. That is a two-round-trip semi-join done in the application. The ponytail comment at sale.service.ts:58-60 already names the ceiling. Separately, the list page's Due column downloads one row per paid sale ever, to annotate a page of at most 100 rows. Postgres has a 65,535 bind-parameter limit per statement; whether Prisma 7 + adapter-pg chunks a very large `in` inside `aggregate` **needs verification**.
- Impact: payload and parameter count grow linearly with all-time sales on every Sales and Bird Sales page load. This is fine for the first few thousand sales.
- Direction: do the summary as one SQL join or subquery (`SUM(p.amount) WHERE p.ref_id IN (SELECT id FROM "Sale" WHERE ...)`), and scope `paidByRef` to the ids on the requested page.

### P-11: Renaming a Unit or ExpenseCategory cascades code changes into large tables with unindexed FK columns
- Severity: medium
- Location: src/lib/lookup-factory.ts:92-104 (code regenerated on rename unless `stableCode`); src/routes/unit.routes.ts:7, src/routes/expense-category.routes.ts:7; FKs in prisma/migrations/20260818105550_convert_categories_units_to_lookups/migration.sql:71-80, 20260819094534_add_item_unit_conversion/migration.sql:19,42, 20260823140312_warehouse_house_stock_transfer/migration.sql:33
- Evidence:
  ```ts
  const data = options.stableCode ? { label } : { code, label };   // lookup-factory.ts:102
  return await delegate.update({ where: { id }, data });
  ```
  `Unit.code` is referenced `ON UPDATE CASCADE` by `Consumption.unit`, `PurchaseItem.unit`, `SaleItem.unit`, `StockTransfer.unit`, `ItemUnit.unit` and `Item.unit`. `ExpenseCategoryLookup.code` is referenced by `Expense.category`. None of these columns is the leading column of an index (`ItemUnit` has `(item_id, unit)`; `Item.category` is the only indexed code FK). A rename becomes a single statement that scans and rewrites every referencing row of Consumption, PurchaseItem and the others, holding row locks for the whole statement. `remove()` (:120-126) relies on the `ON DELETE RESTRICT` check, which is likewise a sequential scan of each referencing table.
- Impact: this is an admin action and rare. When it happens it rewrites the whole history of the highest-volume tables in one go, which blocks concurrent consumption writes from field devices and bloats those tables.
- Direction: make code immutable for Unit and ExpenseCategory, as TaskType already is via `stableCode`, or index the referencing code columns.

### P-12: `Consumption.item_id` FK has no index
- Severity: low
- Location: prisma/schema.prisma:962-964 (indexes `batch_id`, `(house_id, date)`, `stock_unit_id`); used at src/services/consumption.service.ts:18, src/services/item.service.ts:149 (`_count.consumptions`), src/services/analytics.service.ts:281 (`item: { category: "FEED" }` join)
- Evidence: `...(query.item_id !== undefined && { item_id: query.item_id })` (consumption.service.ts:18). No index leads with `item_id`.
- Impact: filtering consumption by item, and the item delete-guard, scan all of Consumption, a high-volume table. These paths are rarely used today.
- Direction: add `@@index([item_id, date])`.

### P-13: The StockLedger list fetches full Item rows and sorts by an unindexed column when not filtered by item
- Severity: low
- Location: src/services/stock-ledger.service.ts:31-44
- Evidence:
  ```ts
  prisma.stockLedger.findMany({ where, include: { item: true }, orderBy: { occurred_at: "desc" }, ...toSkipTake(query) }),
  prisma.stockLedger.count({ where }),
  ```
  `include: { item: true }` returns every Item column, including `meta_data Json`, for each ledger row. With only `direction`/`reason` filters (or none), `ORDER BY occurred_at DESC LIMIT n` and `count(*)` both scan the whole ledger, because `(item_id, occurred_at)` only helps when `item_id` is given. Deep OFFSET pages get slower linearly.
- Impact: the ledger page gets slower as the ledger grows. The page cap is 100.
- Direction: `select` only the item's `name` and `unit`, and add an `occurred_at` index if the unfiltered ledger view is used.

### P-14: Several list endpoints use deep or wide `include`s
- Severity: low
- Location: src/services/stock-house-allocation.service.ts:17-20; src/services/consumption.service.ts:29; src/services/stock-unit.service.ts:12-20, :39-44; src/services/task-assignment.service.ts:14-18; src/services/purchase.service.ts:181; src/services/inventory-adjustment.service.ts:18
- Evidence:
  ```ts
  include: { house: true, stock_unit: { include: { purchase_item: { include: { item: true } } } } },   // stock-house-allocation:17-20
  include: { batch: true, house: true, item: true, stock_unit: true },                                  // consumption:29
  houseAllocations: { orderBy: { occurred_at: "desc" }, take: 1, include: { house: true } },            // stock-unit:14-18
  ```
  Each list (up to 100 rows) returns complete related rows, three or four levels deep, where the UI needs names. For StockUnit, a nested `take: 1` on a to-many relation across many parents: whether Prisma 7's default relation-load strategy fetches all allocations for the page's units and slices them in memory **needs verification**. No `relationJoins` preview or `relationLoadStrategy` is configured (schema.prisma:6-9). `StockUnit.getAll` also supports `id: { contains, mode: "insensitive" }` (:35-37), which always scans the table, and sorts by unindexed `created_at`.
- Impact: payloads are larger and there are several round trips per list. At 100-row pages this is modest.
- Direction: replace whole-row includes with `select`s of the displayed fields, and confirm the nested-`take` behaviour with query logging.

### P-15: `PurchaseService.create` runs 3-4 sequential queries per line inside the interactive transaction
- Severity: low
- Location: src/services/purchase.service.ts:100-164; src/lib/unit-conversion.ts:19-27
- Evidence:
  ```ts
  for (const item of itemsWithTotals) {
      const base_quantity = await toBaseQuantity(tx, item.item_id, item.unit, item.quantity, "PURCHASE");  // 1-2 reads
      const purchaseItem = await tx.purchaseItem.create({...});
      await StockLedgerService.record(tx, {...});
  }
  return tx.purchase.findUniqueOrThrow({ where: { id: purchase.id }, include });
  ```
  The transaction stays open for about 4×lines + 2 round trips. `SaleService.create` already batches its lines with `createMany` (sale.service.ts:111).
- Impact: a 20-line purchase holds one pooled connection and its row locks for about 80 round trips. This is tolerable on a LAN DB and grows with remote DB latency.
- Direction: pre-load the Item units and ItemUnit conversions for all lines in two queries, then `createManyAndReturn` the PurchaseItems and `createMany` the ledger rows.

### P-16: Dashboard aggregates load whole relations, then filter or reduce in JS
- Severity: low
- Location: src/services/analytics.service.ts:22-25 and :34-36; :93-117
- Evidence:
  ```ts
  prisma.houses.findMany({ where: { is_active: true }, include: { batchHouseBalances: true } }),   // :22-25
  const housesOccupied = houses.filter((h) => h.batchHouseBalances.some((b) => b.quantity > 0)).length;  // :34
  ...
  prisma.weightRecords.findMany({ where: { batch_id: { in: batchIds } }, orderBy: { date: "desc" } }),   // :105-108
  // then JS keeps only the first row per batch
  ```
  `farmOverview` loads every historical balance row per house, including zeroed rows from closed batches, to compute one count. `batchesPerformance` with no `status` filter loads every weight record for every batch ever, with all columns, to keep one row per batch.
- Impact: both grow with all-time history and sit on the dashboard landing path. Volume is small: houses × batches and batches × houses × weigh-days.
- Direction: a `count` with a relation filter, and a `distinct: ["batch_id"]` with `orderBy` (or `DISTINCT ON`) restricted to the needed columns.

### P-17: `revenueVsExpenses` fires 3 × `months` aggregates at once (up to 72)
- Severity: low
- Location: src/services/analytics.service.ts:525-550; src/validators/analytics.validator.ts:22-23
- Evidence: `windows.map(async (...) => Promise.all([sale.aggregate, birdSale.aggregate, expense.aggregate]))`, with `months` up to 24. All aggregates are issued together against the single `PrismaPg` pool (src/lib/db.ts:9-11; pg's default pool size is 10, assuming it isn't overridden in `DATABASE_URL`).
- Impact: one request can briefly take every pooled connection and queue other users' queries behind it. Each aggregate is a date-only filter with no usable index (see P-7).
- Direction: three `GROUP BY date_trunc('month', ...)` queries in place of 3×N aggregates.

### P-18: Stock balance, valuation and cash position are recomputed from full history on every request
- Severity: low
- Location: src/lib/stock-balance.ts:10-27, :58-106, :115-132; src/lib/stock-value.ts:14-30; src/services/payment-instrument.service.ts:102-119; callers src/services/item.service.ts:170-188, src/services/analytics.service.ts:558-578, src/services/alert.service.ts:49-70
- Evidence: there is no balance or snapshot table. Every low-stock check, catalog load (`getStockByLocation`: "ponytail: one groupBy over the full ledger", :56-57), valuation (`getItemAvgCosts` sums all-time PurchaseItems) and instrument balance sums the complete all-time ledger.
- Impact: realistically fine at one farm for several years, since grouped sums over tens of thousands of rows take milliseconds with the item index. Recorded here because the cost grows without bound and the same full sum runs inside the Consumption and Transfer write transactions (`getItemLocationBalance`). With the P-6 index this stays cheap for much longer.
- Direction: none needed now. If the ledger reaches hundreds of thousands of rows, add periodic balance snapshots (opening balance + delta).

### P-19: Indexes that no query uses, including two on the hottest ledger tables
- Severity: low
- Location: prisma/schema.prisma:502 (`Profiles @@index([role])`), :1083 (`StockLedger @@index([ref_type, ref_id])`), :1131 (`StockTransfer @@index([to_location_type, to_location_id])`), :1254 (`Expense @@index([cost_type])`)
- Evidence: grep over src/ (excluding tests):
  - No `profiles.findMany/count/findFirst` filters on `role`.
  - StockLedger is never queried by `ref_id`. The only reads are by `item_id`, location or `occurred_at`.
  - StockTransfer is never read with `findMany`/`count`/`groupBy` (only created).
  - `cost_type` is a two-value enum and is always combined with `batch_id` in reads (analytics.service.ts:157, :161), where `(batch_id, date)` is the better access path. Its only solo use, the `expense.getAll` filter (expense.service.ts:14), is too unselective for an index to help.
- Impact: write amplification on StockLedger, the highest-insert table, plus small storage overhead. `(ref_type, ref_id)` on StockLedger may still be wanted for future traceability ("ledger rows for this purchase line").
- Direction: drop the indexes with no reads, or keep `StockLedger(ref_type, ref_id)` deliberately and document why.

### P-20: Device auth writes `last_seen_at` on every authenticated request
- Severity: low
- Location: src/services/device.service.ts:77-90
- Evidence:
  ```ts
  const device = await prisma.device.findUnique({ where: { token_hash: hashToken(token) }, ... });
  if (!device || device.revoked_at) return null;
  await prisma.device.update({ where: { id: device.id }, data: { last_seen_at: new Date() } });
  ```
- Impact: every ingest POST costs an extra UPDATE and a new row version. This is negligible with a few phones and becomes noticeable only if devices poll.
- Direction: only write when `last_seen_at` is older than a threshold (for example, one minute).

### P-21: Other pre-checks run outside the write they guard
- Severity: low
- Location: src/services/batch.service.ts:128-142 (status and remaining-bird check before `$transaction`); src/services/stock-unit.service.ts:143-168 (latest allocation read, then create, with no transaction); src/services/payroll-record.service.ts:124-157 (existence check then create, no transaction, P2002 not caught by `handlePrismaWriteError`); src/services/alert.service.ts:27-47 (see P-8)
- Evidence: for example, in `BatchService.close`, `batch.status !== "RUNNING"` and `remaining` are computed from a read at :128, and the transaction at :142 neither re-reads nor conditions on them. In `StockUnitService.relocate`, `type` is derived from `latest` (:143-157), which a concurrent relocate can change before :160 inserts.
- Impact: these are rare, low-cost races. A double close can double-run depreciation upserts (made idempotent by `@@unique([asset_id, batch_id])`). A concurrent relocate can record the wrong ALLOCATION or REALLOCATION type. A concurrent payroll generate returns an unhandled 500, not a 409.
- Direction: move each guard into the same transaction or conditional write, and wrap `payrollRecord.create` with `handlePrismaWriteError`.

### P-22: Missing indexes on FK, filter and sort columns of low-volume tables
- Severity: low
- Location: prisma/schema.prisma — Sale (:1167-1180, no indexes at all: `customer_id`, `sale_date`); BirdSale `customer_id`, `house_id`, standalone `sale_date` (:1232); Expense `category`, standalone `date` (:1253-1254); Purchase `warehouse_id`, standalone `purchase_date` (:821); PurchaseItem `expiration_date` (alert.service.ts:103); AssetDepreciation `batch_id` (:931; analytics.service.ts:164-167); WeightRecords `house_id` (:1046; weight-record.service.ts:13); Payment `payment_date` (payment.service.ts:107); StockUnit `created_at` (stock-unit.service.ts:43); Alerts `created_at`/`status` (alert.service.ts:241-246); EnvironmentRecords standalone `recorded_at` (environment-record.service.ts:16-19)
- Evidence: each column appears in a `where` or `orderBy` in the cited service with no index leading on it. For example, `prisma.sale.findMany({ where, include, orderBy: { created_at: "desc" }, ... })` (sale.service.ts:34-38) filters by `customer_id`/`sale_date` with no index.
- Impact: at one farm these tables hold hundreds to low thousands of rows a year, so the sequential scans are sub-millisecond. These become worth adding at roughly 10^5 rows, or alongside the P-7 work.
- Direction: none needed now. Revisit with `pg_stat_user_tables.seq_scan` and `pg_stat_statements` once production data exists.
