# 05 — Solutions
- Date: 2026-10-06
- Commit: server@df7bc95
- Files analyzed: 04-issues.md, findings/01-design.md, findings/02-performance.md, findings/03-security.md, + source files read: prisma/schema.prisma (full); package.json (prisma 7.8.0); index.ts; src/App.ts; src/routes/{index,unit,item-category,expense-category,supplier-supply-category,task-type,device,ingest,alert,employee}.routes.ts; src/lib/{lookup-factory,current-actor,db,prisma-errors,pagination,stock-balance,unit-conversion,alert-scan-loop,cloudinary-signature}.ts; src/middlewares/require-device.ts; src/controllers/{upload,ingest,batch}.controller.ts; src/services/{payroll-payout,ingest,bird-sale,device,analytics,payment,payment-instrument,sale,transfer,consumption,mortality-log,batch-house-allocation,batch,employee,employee-payout-account,performance-score-entry,alert,house,stock-unit,inventory-adjustment,item,stock-ledger,stock-house-allocation,purchase,payroll-record,weight-record,warehouse}.service.ts; src/validators/{payroll-payout,ingest,device,payment,payment-instrument,performance-score-entry,inventory-adjustment,transfer,weight-record,bird-sale,expense,purchase,batch}.validator.ts; docs/system-design-arc.md:140-147. Client usage checked in ../web/src and ../mobile/src (see each "Migration risk").

**Read this first. These conventions apply to every fix below.**

- **Partial unique indexes go in the schema.** Prisma 7.8 ships the `partialIndexes` preview feature (confirmed in `node_modules/prisma/build/prisma_schema_build_bg.wasm`). Turn it on once:
  ```diff
   generator client {
     provider = "prisma-client"
     output   = "./generated/prisma"
  +  previewFeatures = ["partialIndexes"]
   }
  ```
  After that, `@@unique([...], where: raw("..."))` lives in `schema.prisma` and `migrate dev` manages it. If you hand-write a partial or expression index in raw SQL without the flag, the next generated migration treats it as drift and drops it. DES-02, DES-07, DES-12 and PERF-06 all depend on this flag.
- **CHECK constraints go in raw SQL.** Prisma does not model them. Create the migration with `bunx prisma migrate dev --create-only`, append the `ALTER TABLE ... ADD CONSTRAINT ... CHECK (...)` lines, then apply. Prisma's diff leaves CHECK constraints alone.
- **Locking helper.** No lock helper exists in `src/lib`. Where a fix needs a row-independent lock, it uses one inline line: `await tx.$executeRaw\`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))\``. Use `$executeRaw`, not `$queryRaw`: the function returns `void`, and `$queryRaw` fails to deserialize a `void` column. The lock is transaction-scoped, so it releases on commit or rollback.
- **What "Safe to do now" covers.** It includes additive index migrations. Postgres `CREATE INDEX` (Prisma does not emit `CONCURRENTLY`) blocks writes to that one table while the index builds. At this farm's volume (≤10^5 rows per table) that takes well under a second, and field devices already retry with idempotency keys.

---

## Safe to do now

### DES-01: Lookup code changes on rename
- **Fix:** Make `code` immutable for every lookup. Do this by deleting the option, since every lookup now gets the behaviour `stableCode` gave TaskType.
  ```diff
  // src/lib/lookup-factory.ts:92-107
        async update(id: string, label: string) {
            const existing = await delegate.findUnique({ where: { id } });
            if (!existing) throw AppError.notFound(resourceName);
  -         const code = generateCode(label);
  -         if (!code)
  +         if (!generateCode(label))
                throw AppError.badRequest("Label must contain at least one letter or number");
            try {
  -             const data = options.stableCode ? { label } : { code, label };
  -             return await delegate.update({ where: { id }, data });
  +             // ponytail: code is set once at create and never moves -- app logic and
  +             // ON UPDATE CASCADE FKs key on it (FEED, KG, SALARY...).
  +             return await delegate.update({ where: { id }, data: { label } });
  ```
  Then remove `LookupOptions`/`options` (lookup-factory.ts:51-70) and the `{ stableCode: true }` argument at task-type.routes.ts:13. In `src/lib/lookup-factory.test.ts`, delete the "update recomputes code by default" test (:56) and the separate `stableCode` describe block (:97); one "rename keeps code" test now covers all lookups.
- **Why this is the simplest:** It removes code instead of adding it. A stable code also means a rename no longer cascades into Consumption/PurchaseItem, which resolves the P-11 lock and rewrite cost without new indexes on the code FK columns.
- **Migration risk:** No schema change. Pre-check that no literal code has already drifted from what the code expects (each query should return every expected code):
  ```sql
  SELECT code FROM "ItemCategory" WHERE code IN ('FEED','MEDICINE','VACCINE');
  SELECT code FROM "Unit" WHERE code IN ('LITER','KG','UNIT','DOSE','PCS','METER','CONTAINER');
  SELECT code, label FROM "ExpenseCategoryLookup" WHERE code LIKE 'SALARY%';
  ```
  If one is missing, someone already renamed it. Fix it with a one-off `UPDATE ... SET code = 'FEED'`, which cascades as it does today. The response shape does not change. Web `lookup-manager-card.tsx` only sends `label`.
- **Effort:** S

### DES-02: Payroll markPaid double-submit
- **Fix:** Claim the row inside the transaction with a conditional update, and add a DB rule of one PAYROLL cash row per payout.
  ```diff
  // src/services/payroll-payout.service.ts:131-136, :148, :211-220
      async markPaid(id: string, data: MarkPaidInput) {
          const payout = await prisma.payrollPayout.findUnique({ where: { id } });
          if (!payout) throw AppError.notFound("Payout");
  -       if (payout.status === "CONFIRMED") {
  -           throw AppError.badRequest("Payout is already confirmed");
  -       }
  ...
          return prisma.$transaction(async (tx) => {
  +           // Claim first: a concurrent second call blocks on the row lock, then
  +           // matches 0 rows and aborts before any ledger write.
  +           const claimed = await tx.payrollPayout.updateMany({
  +               where: { id, status: { not: "CONFIRMED" } },
  +               data: { status: "CONFIRMED", paid_at, transaction_ref: data.transaction_ref, paid_by_id: data.paid_by_id },
  +           });
  +           if (claimed.count === 0) throw AppError.badRequest("Payout is already confirmed");
              ...expense / fee / payment writes unchanged...
  -           return tx.payrollPayout.update({ where: { id }, data: { status: "CONFIRMED", ... }, include });
  +           return tx.payrollPayout.findUniqueOrThrow({ where: { id }, include });
          });
  ```
  Apply the same claim to `markFailed` (:226-237): `updateMany({ where: { id, status: { not: "CONFIRMED" } }, data: { status: "FAILED", ... } })`.
  ```diff
  // prisma/schema.prisma, model Payment (:1274)
     @@index([ref_type, ref_id])
  +  @@unique([ref_id], where: raw("ref_type = 'PAYROLL'"), map: "Payment_payroll_ref_id_key")
  ```
- **Why this is the simplest:** A conditional `updateMany` is the standard single-statement claim and needs no lock. The partial unique is one line that encodes "a payout leaves the wallet once" for every future writer as well.
- **Migration risk:** The partial unique fails if a double payment already exists. Pre-check:
  ```sql
  SELECT ref_id, count(*) FROM "Payment" WHERE ref_type = 'PAYROLL' GROUP BY ref_id HAVING count(*) > 1;
  ```
  Any rows found are a real double payment. Reverse them by hand (delete the extra Payment and its two Expenses, matched via `remarks LIKE '%<payout id>%'`) before migrating. The response shape does not change.
- **Effort:** S

### SEC-03: Payout create trusts body account_number/amount
- **Fix:** Take the destination and amount only from server data.
  ```diff
  // src/validators/payroll-payout.validator.ts:7-16
   export const createPayrollPayoutSchema = z.object({
       payroll_record_id: z.string().uuid(),
       payout_account_id: z.string().uuid().optional(),
  -    method: method.optional(),
  -    account_number: z.string().optional(),
  -    amount: z.coerce.number().positive("Amount must be positive").optional(),
   });
  ```
  ```diff
  // src/services/payroll-payout.service.ts:82-109
  -       const account = data.payout_account_id
  -           ? await prisma.employeePayoutAccount.findUnique({ where: { id: data.payout_account_id } })
  -           : data.method
  -             ? null
  -             : await prisma.employeePayoutAccount.findFirst({ ... });
  +       const account = data.payout_account_id
  +           ? await prisma.employeePayoutAccount.findUnique({ where: { id: data.payout_account_id } })
  +           : await prisma.employeePayoutAccount.findFirst({
  +                 where: { employee_id: record.employee_id, active_to: null },
  +                 orderBy: { active_from: "desc" },
  +             });
  -       const method = data.method ?? account?.method;
  -       const account_number = data.account_number ?? account?.account_number;
  -       if (!method || !account_number) {
  +       if (!account || account.active_to) {
                throw AppError.badRequest("No active payout account on file ...");
            }
            if (account.employee_id !== record.employee_id) { ... }
  -       const amount = data.amount ?? record.total_pay;
  +       const { method, account_number } = account;
  +       const amount = record.total_pay;
  ```
- **Why this is the simplest:** It deletes three body fields and one branch. The `data.method` path only existed for CASH, which `employee-payout-account.validator.ts:4-7` already bars. The added `active_to` check also stops a payout to a closed account.
- **Migration risk:** None to the schema. Client check: web `payout-dialog.tsx:110-116` sends only `{ payroll_record_id, payout_account_id }`, and mobile never calls `/payroll-payouts`. Zod strips unknown keys, so an old client that still sent `amount` would be ignored rather than rejected. Partial or advance payouts become impossible. That is correct today, because no UI offers them.
- **Effort:** S

### DES-05: Ingest confirm can create duplicate BirdSales
- **Fix:** Claim the staging row and create the sale in one transaction. To do that, BirdSaleService needs a tx-accepting body.
  ```diff
  // src/services/bird-sale.service.ts:80-144
  -   async create(data: CreateBirdSaleInput) {
  -       const total_amount = ...; ... due_amount checks ...
  -       try {
  -           return await prisma.$transaction(async (tx) => {
  -               ...body...
  -           });
  -       } catch (err) { return handlePrismaWriteError(err); }
  -   },
  +   async create(data: CreateBirdSaleInput) {
  +       try {
  +           return await prisma.$transaction((tx) => BirdSaleService.createIn(tx, data));
  +       } catch (err) { return handlePrismaWriteError(err); }
  +   },
  +   /** Same write, inside a caller's transaction (IngestService.confirm). */
  +   async createIn(tx: Prisma.TransactionClient, data: CreateBirdSaleInput) {
  +       ...money math + the old transaction body, moved verbatim...
  +   },
  ```
  ```diff
  // src/services/ingest.service.ts:69-110
      async confirm(id: string, input: ConfirmIngestedInput) {
  -       const row = await prisma.ingestedSale.findUnique({ where: { id } });
  -       if (!row) throw AppError.notFound("IngestedSale");
  -       if (row.status !== "PENDING") throw AppError.conflict(...);
  -       const birdSale = await BirdSaleService.create({ ... });
  -       await prisma.ingestedSale.update({ ... });
  -       return birdSale!;
  +       try {
  +           return await prisma.$transaction(async (tx) => {
  +               const claimed = await tx.ingestedSale.updateMany({
  +                   where: { id, status: "PENDING" },
  +                   data: { status: "CONFIRMED", reviewed_by_id: input.reviewed_by_id, reviewed_at: new Date() },
  +               });
  +               const row = await tx.ingestedSale.findUnique({ where: { id } });
  +               if (!row) throw AppError.notFound("IngestedSale");
  +               if (claimed.count === 0) throw AppError.conflict(`This sale was already ${row.status.toLowerCase()}`);
  +               const birdSale = await BirdSaleService.createIn(tx, { ...same fields as today... });
  +               await tx.ingestedSale.update({ where: { id }, data: { bird_sale_id: birdSale.id } });
  +               return birdSale;
  +           });
  +       } catch (err) { return handlePrismaWriteError(err); }
      },
  ```
  Use the same claim in `dismiss` (:113-128): `updateMany({ where: { id, status: "PENDING" } ... })`.
- **Why this is the simplest:** It reuses the existing `$transaction` and the existing BirdSale logic, with no new table or lock. The second confirm blocks on the row lock, then matches 0 rows and aborts before any sale is written. A crash mid-way rolls everything back, so the row stays PENDING and no sale exists.
- **Migration risk:** No schema change. Response shape is unchanged (it still returns the BirdSale). Check whether duplicates already exist:
  ```sql
  SELECT i.id, i.bird_sale_id FROM "IngestedSale" i WHERE i.status = 'PENDING' AND EXISTS (
    SELECT 1 FROM "BirdSale" b WHERE b.sale_date = i.device_sale_date AND b.recorded_by_id = i.recorded_by_id);
  ```
  This is a heuristic. Review any hits by hand.
- **Effort:** M

### SEC-04: List endpoints return PII and account numbers
- **Fix:** Narrow the employee list to the fields the web and mobile lists actually read. Leave detail endpoints (`getById`) unchanged.
  ```diff
  // src/services/employee.service.ts (new const near :14) and :59-64
  +const listSelect = {
  +    id: true, profile_id: true, role: true, employment_status: true, joining_date: true,
  +    rating: true, reference_salary: true, terminated_at: true, created_at: true,
  +    profile: { select: { id: true, name: true, mobile: true, is_active: true, avatar: true } },
  +} as const;
  ...
            prisma.employees.findMany({
                where,
  -             include,
  +             select: listSelect,
  ```
  Leave payout-account and payment-instrument account numbers as they are until SEC-01 lands. The web pickers display them (`payout-dialog.tsx:32`, `payout-accounts-card.tsx:43,74`), and masking them does not stop an unauthenticated caller from reading `getById`. The ingest `payload` (buyer_name) is what the review dialog renders (`confirm-ingested-dialog.tsx:57-184`), so it stays.
- **Why this is the simplest:** One `select` constant on the endpoint that leaks the most (NID, DOB, emergency and reference contacts). The real control is SEC-01. Field masking without auth is mostly cosmetic.
- **Migration risk:** API shape shrinks. I checked every reader of `GET /employees`. Web (`employees-table-section.tsx`, `performance-leaderboard-card.tsx`, `employee-form-page.tsx:283-286`) reads `id, role, employment_status, joining_date, rating, reference_salary, profile.{name,mobile,is_active,avatar}`. Mobile (`profile.tsx`, `(tabs)/index.tsx`, `team/index.tsx`, `employee-picker.tsx`) reads `id, role, joining_date, profile.{name,mobile}`. All of these are kept.
- **Effort:** S

### DES-08: setActive desyncs employment state
- **Fix:** Delete the two endpoints. Terminate and reinstate already move both halves together.
  ```diff
  // src/routes/employee.routes.ts:32-33
  -employeeRoutes.post("/:id/deactivate", EmployeeController.deactivate);
  -employeeRoutes.post("/:id/reactivate", EmployeeController.reactivate);
  ```
  Also delete `EmployeeService.setActive` (employee.service.ts:374-379) and the two controller methods.
- **Why this is the simplest:** Deletion. Neither web nor mobile calls `/employees/:id/(de|re)activate`; I grepped both. The correct paths (`/terminate`, `/reinstate`) already exist.
- **Migration risk:** Find rows that have already desynced and repair them by routing them through reinstate or terminate:
  ```sql
  SELECT e.id FROM "Employees" e JOIN "Profiles" p ON p.id = e.profile_id
  WHERE (e.employment_status = 'TERMINATED') = p.is_active;
  ```
- **Effort:** S

### PERF-01: PurchaseItem.purchase_id unindexed
- **Fix:** This goes in the one shared index migration with PERF-02, -03, -05, -08, -09 and -11. Its line:
  ```diff
  // prisma/schema.prisma, model PurchaseItem (:849)
  +  @@index([purchase_id])
     @@index([item_id])
     @@index([batch_id])
  ```
- **Why this is the simplest:** An index is the whole fix.
- **Migration risk:** Additive. Brief write lock on PurchaseItem during the build. No API change.
- **Effort:** S

### PERF-02: Payment instrument FKs unindexed; dashboard fans out per instrument
- **Fix:**
  ```diff
  // prisma/schema.prisma, model Payment (:1274), part of the shared index migration (see PERF-01)
     @@index([ref_type, ref_id])
  +  @@index([from_instrument_id])
  +  @@index([to_instrument_id])
  ```
  ```diff
  // src/services/analytics.service.ts:226-232 -- two groupBys instead of 3 queries per instrument
  -       const balances = await Promise.all(
  -           instruments.map((inst) => PaymentInstrumentService.getBalance(inst.id)),
  -       );
  +       const ids = instruments.map((i) => i.id);
  +       const [ins, outs] = await Promise.all([
  +           prisma.payment.groupBy({ by: ["to_instrument_id"], where: { to_instrument_id: { in: ids } }, _sum: { amount: true } }),
  +           prisma.payment.groupBy({ by: ["from_instrument_id"], where: { from_instrument_id: { in: ids } }, _sum: { amount: true } }),
  +       ]);
  +       const zero = new Prisma.Decimal(0);
  +       const inBy = new Map(ins.map((r) => [r.to_instrument_id, r._sum.amount ?? zero]));
  +       const outBy = new Map(outs.map((r) => [r.from_instrument_id, r._sum.amount ?? zero]));
  +       const balances = ids.map((id) => ({ balance: (inBy.get(id) ?? zero).minus(outBy.get(id) ?? zero) }));
  ```
  The rest of the function, which reads `balances[i]!.balance`, stays as it is.
- **Why this is the simplest:** Two indexes plus two grouped queries. A cache or a balance table is not needed at this volume.
- **Migration risk:** Additive indexes. The response shape is identical.
- **Effort:** S

### PERF-03: StockLedger has no (location_type, location_id) index
- **Fix:**
  ```diff
  // prisma/schema.prisma, model StockLedger (:1082), part of the shared index migration
     @@index([item_id, occurred_at])
     @@index([ref_type, ref_id])
  +  @@index([location_type, location_id, item_id])
  ```
- **Why this is the simplest:** One index serves `getLocationStock`, the house and warehouse delete guards, and `getItemLocationBalance`, which runs inside the Consumption and Transfer write transactions.
- **Migration risk:** Additive. StockLedger is the largest table, but it is still small in absolute terms. Brief write lock during the build.
- **Effort:** S

### PERF-04: Ingested-sales list is unpaginated
- **Fix:** Paginate it like every other list. The server and web changes ship together.
  ```diff
  // src/validators/ingest.validator.ts:44-46
  -export const listIngestedQuerySchema = z.object({
  +export const listIngestedQuerySchema = paginationQuerySchema.extend({
       status: z.enum(["PENDING", "CONFIRMED", "DISMISSED"]).optional(),
   });
  ```
  ```diff
  // src/services/ingest.service.ts:55-64
  -   async list(status?: string) {
  -       return prisma.ingestedSale.findMany({
  -           where: { ...(status !== undefined && { status }) },
  +   async list(query: ListIngestedQuery) {
  +       const where = { ...(query.status !== undefined && { status: query.status }) };
  +       const [rows, total] = await Promise.all([
  +           prisma.ingestedSale.findMany({ where, ...toSkipTake(query),
                orderBy: { received_at: "desc" },
                include: { ... },
  -       });
  +           }),
  +           prisma.ingestedSale.count({ where }),
  +       ]);
  +       return { rows, meta: buildMeta(total, query) };
  ```
  The controller (ingest.controller.ts:25-30) switches to `sendList` like its siblings. Web `incoming-tab.tsx:17-21` changes to `useGetData<Paginated<IngestedSale>>("/ingest/v1/sales?status=PENDING&limit=100", ...)` and `data?.results ?? []`.
- **Why this is the simplest:** It reuses `toSkipTake`/`buildMeta`. `payload` stays in the list because the review dialog reads it straight from the list row. Pagination alone bounds the response size.
- **Migration risk:** This is a response shape change: a bare array becomes `{ results, meta }`. Deploy the server and web together. Mobile does not call this endpoint, and PoultryScale only POSTs.
- **Effort:** S

### SEC-05: approved_by_id not checked
- **Fix:** Require the approver to be an Admin. The web picker (`ActorSelect`) already lists only admins.
  ```diff
  // src/services/performance-score-entry.service.ts, before the create at :118
  +       if (data.approved_by_id !== undefined) {
  +           const approver = await prisma.admins.findUnique({ where: { profile_id: data.approved_by_id } });
  +           if (!approver) throw AppError.badRequest("approved_by_id must be an admin");
  +       }
  ```
- **Why this is the simplest:** It is a single lookup. Stamping the approver from a session is the real fix, but it depends on SEC-01. Until auth exists, anyone can still name any admin, so this only closes the "any profile" hole.
- **Migration risk:** Find existing entries approved by a non-admin and review them:
  ```sql
  SELECT s.id FROM "PerformanceScoreEntry" s WHERE s.approved_by_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Admins" a WHERE a.profile_id = s.approved_by_id);
  ```
- **Effort:** S

### SEC-06: Instrument account numbers editable after use
- **Fix:** Refuse a change to `account_no`/`mobile_no` once any Payment references the instrument. Compare against the stored value, because the web edit form re-sends both fields on every save (`instrument-form-dialog.tsx:103-104`).
  ```diff
  // src/services/payment-instrument.service.ts:50-58
  -       const instrument = await prisma.paymentInstrument.findUnique({ where: { id } });
  +       const instrument = await prisma.paymentInstrument.findUnique({
  +           where: { id },
  +           include: { _count: { select: { payments_from: true, payments_to: true } } },
  +       });
            if (!instrument) throw AppError.notFound("PaymentInstrument");
  +       const changesIdentity =
  +           (account_no !== undefined && account_no !== instrument.account_no) ||
  +           (mobile_no !== undefined && mobile_no !== instrument.mobile_no);
  +       if (changesIdentity && instrument._count.payments_from + instrument._count.payments_to > 0) {
  +           throw AppError.conflict("This account has payment history -- create a new instrument and deactivate this one");
  +       }
  ```
  (Move the destructuring at :54 above this block.)
- **Why this is the simplest:** It reuses the "history means immutable" rule that `remove()` (:78-93) already applies. There is no audit table to write.
- **Migration risk:** None. Label, bank name and type edits still work.
- **Effort:** S

### DES-11: is_unit_tracked not enforced; consumption item mismatch
- **Fix:** Two guards and one comment correction.
  ```diff
  // src/services/consumption.service.ts:62-68
  -                   const unit = await tx.stockUnit.findUnique({ where: { id: unitId } });
  +                   const unit = await tx.stockUnit.findUnique({
  +                       where: { id: unitId },
  +                       include: { purchase_item: { select: { item_id: true } } },
  +                   });
                      if (!unit) throw AppError.notFound("StockUnit");
  +                   if (unit.purchase_item?.item_id !== data.item_id) {
  +                       throw AppError.badRequest("That stock unit belongs to a different item");
  +                   }
  ```
  ```diff
  // src/services/item.service.ts:76-77 (update)
            const item = await prisma.item.findUnique({ where: { id } });
            if (!item) throw AppError.notFound("Item");
  +       if (data.is_unit_tracked !== undefined && data.is_unit_tracked !== item.is_unit_tracked
  +           && (await prisma.purchaseItem.count({ where: { item_id: id } })) > 0) {
  +           throw AppError.conflict("Tracking mode can't change once the item has been purchased");
  +       }
  ```
  ```diff
  // prisma/schema.prisma:762-763 (comment only)
  -  // only (StockLedger/StockTransfer -- feed, husk, etc). Gates bind() and TransferService.create()
  -  // so the two mechanisms can't be mixed for one item.
  +  // only (StockLedger/StockTransfer -- feed, husk, etc). Gates bind(). Transfers ARE allowed for
  +  // coded items: relocate() links its StockTransfer so the ledger stays in step.
  ```
- **Why this is the simplest:** Do **not** add the Transfer gate the finding suggests. The web deliberately posts `/stock-transfers` for coded items so the ledger moves with the unit (`stock-unit-detail-sheet.tsx:93`, `stock-allocation-form-dialog.tsx:131`), so the schema comment is what's wrong. The composite FK `(stock_unit_id, item_id)` would need StockUnit to carry a denormalized `item_id`. The in-transaction check gives the same protection with no schema change.
- **Migration risk:** No schema change. Find existing mismatches:
  ```sql
  SELECT c.id FROM "Consumption" c JOIN "StockUnit" s ON s.id = c.stock_unit_id
  JOIN "PurchaseItem" p ON p.id = s.purchase_item_id WHERE p.item_id <> c.item_id;
  ```
  Requiring `stock_unit_id` for coded items is out of scope: mobile `log/consumption.tsx` logs only aggregate draws, and that requirement would break it.
- **Effort:** S

### DES-13: Payment direction free-form; payroll expense payable twice
- **Fix:** Derive `direction` on the server, and refuse payments against payroll-generated expenses.
  ```diff
  // src/validators/payment.validator.ts:19
  -    direction: z.enum(["INCOMING", "OUTGOING"]),
  ```
  ```diff
  // src/services/payment.service.ts
  +const DIRECTION = { SALE: "INCOMING", BIRD_SALE: "INCOMING", PURCHASE: "OUTGOING", EXPENSE: "OUTGOING", PAYROLL: "OUTGOING" } as const;
  ...
  // :56-59 owedForRef EXPENSE case
  -           case "EXPENSE":
  -               return (await tx.expense.findUnique({ where: { id: ref_id }, select: { amount: true } }))?.amount;
  +           case "EXPENSE": {
  +               const e = await tx.expense.findUnique({ where: { id: ref_id }, select: { amount: true, category: true } });
  +               // Payroll expenses are settled by their payout's own PAYROLL Payment.
  +               if (e && (e.category === "SALARY" || e.category === "SALARY_TRANSFER_FEE")) {
  +                   throw AppError.badRequest("Salary expenses are paid through their payroll payout");
  +               }
  +               return e?.amount;
  +           }
  ...
  // :140
  -                       direction: data.direction,
  +                       direction: DIRECTION[data.ref_type],
  ```
- **Why this is the simplest:** It removes an input instead of validating it. Zod strips the `direction` key that web still sends (`payment-create-dialog.tsx:37,56`), so no client breaks. The category check depends on DES-01, which keeps `SALARY` stable. A real FK from Expense to PayrollPayout would need a migration and buys nothing more here.
- **Migration risk:** No schema change. Find past damage:
  ```sql
  SELECT p.id FROM "Payment" p WHERE p.direction <> CASE p.ref_type WHEN 'SALE' THEN 'INCOMING' WHEN 'BIRD_SALE' THEN 'INCOMING' ELSE 'OUTGOING' END::"PaymentType";
  SELECT p.id FROM "Payment" p JOIN "Expense" e ON e.id = p.ref_id WHERE p.ref_type = 'EXPENSE' AND e.category IN ('SALARY','SALARY_TRANSFER_FEE');
  ```
  Later, drop the now-unused Direction select from the web dialog (cosmetic).
- **Effort:** S

### DES-14: InventoryAdjustment trusts client stock; reason never maps
- **Fix:** Compute `quantity_before` from the ledger inside the transaction, and map the existing reason strings onto StockReason.
  ```diff
  // src/services/inventory-adjustment.service.ts:29-59
  +const LEDGER_REASON: Record<string, "WASTAGE" | "EXPIRED" | "OPENING_BALANCE"> = {
  +    Wastage: "WASTAGE", Expired: "EXPIRED", "Opening balance": "OPENING_BALANCE",
  +};
      async create(data: CreateInventoryAdjustmentInput) {
  -       const before = new Prisma.Decimal(data.quantity_before);
  -       const after = new Prisma.Decimal(data.quantity_after);
  -       const delta = after.minus(before);
  -       if (delta.isZero()) throw ...
            try {
                return await prisma.$transaction(async (tx) => {
  +               const location_type = data.house_id ? "HOUSE" : "WAREHOUSE";
  +               const location_id = (data.house_id ?? data.warehouse_id)!;
  +               // Server is the source of "before"; the client's figure is ignored.
  +               const before = await getItemLocationBalance(tx, data.item_id, location_type, location_id);
  +               const after = new Prisma.Decimal(data.quantity_after);
  +               const delta = after.minus(before);
  +               if (delta.isZero()) throw AppError.badRequest("Count matches the current balance -- nothing to adjust");
                    ...
  -                   reason: "ADJUSTMENT",
  +                   reason: LEDGER_REASON[data.reason] ?? "ADJUSTMENT",
  -                   ...(data.warehouse_id !== undefined && { location_type: "WAREHOUSE" ... }),
  -                   ...(data.house_id !== undefined && { location_type: "HOUSE" ... }),
  +                   location_type, location_id,
  ```
  ```diff
  // src/validators/inventory-adjustment.validator.ts
  -        quantity_before: z.coerce.number().nonnegative(),
  +        quantity_before: z.coerce.number().nonnegative().optional(), // ignored; kept so old clients validate
  ...
  -    .refine((data) => data.warehouse_id !== undefined || data.house_id !== undefined, {
  -        message: "At least one of warehouse_id/house_id is required",
  +    .refine((data) => (data.warehouse_id === undefined) !== (data.house_id === undefined), {
  +        message: "Exactly one of warehouse_id/house_id is required",
  ```
- **Why this is the simplest:** It reuses `getItemLocationBalance` and the reason strings the web already sends (`web/src/pages/inventory/types.ts:102-111`, plus `"Opening balance"` at adjustment-form-dialog.tsx:74). It needs no enum migration, and the wastage report starts filling immediately.
- **Migration risk:** No schema change. Behaviour changes: the "Quantity before" field the user types is no longer trusted. Later, make it a read-only display of the server balance in `adjustment-form-dialog.tsx`. Historical rows keep their client-entered `quantity_before`; this is not backfillable, so accept it. Caveat: for coded (`is_unit_tracked`) items, location balances are approximate (consumption.service.ts:115-117), so counts adjusted for those items post deltas against that approximation.
- **Effort:** S

### PERF-05: Trend endpoints filter on date with no usable index
- **Fix:** Add date-leading indexes on the two high-volume tables, in the shared index migration. Keep the JS bucketing.
  ```diff
  // model StockLedger
  +  @@index([occurred_at])
  // model Consumption
  +  @@index([date])
  ```
- **Why this is the simplest:** Moving the bucketing to SQL (`$queryRaw` + `date_trunc`) would add the codebase's first raw-SQL read path to save serialising a few thousand rows. That is not worth it at one farm. Revisit only if a 365-day chart is measurably slow. Mortality, BirdSale, Purchase and Expense are low-volume (see PERF-13).
- **Migration risk:** Additive. `StockLedger(occurred_at)` also serves PERF-09.
- **Effort:** S

### PERF-06: Alert scan dedupe race and missing index
- **Fix:** Add a partial unique index for "one ACTIVE alert per (type, related_id)" and let the insert race resolve through it.
  ```diff
  // prisma/schema.prisma, model Alerts (:1471)
     idempotency_key String            @unique
  +
  +  @@unique([type, related_id], where: raw("status = 'ACTIVE'"), map: "Alerts_one_active_key")
  +  @@index([status, created_at])
  ```
  ```diff
  // src/services/alert.service.ts:27-47
   async function upsertActiveAlert(draft: AlertDraft) {
  -    if (draft.related_id) {
  -        const existing = await prisma.alerts.findFirst({ where: { type: draft.type, related_id: draft.related_id, status: "ACTIVE" } });
  -        if (existing) return existing;
  -    }
  -    return prisma.alerts.create({ ... });
  +    try {
  +        return await prisma.alerts.create({ ...unchanged data... });
  +    } catch (err) {
  +        // Already ACTIVE (the partial unique) -- that's the dedupe.
  +        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
  +            return prisma.alerts.findFirst({ where: { type: draft.type, related_id: draft.related_id, status: "ACTIVE" } });
  +        }
  +        throw err;
  +    }
   }
  ```
- **Why this is the simplest:** One index fixes the race (including a manual `POST /alerts/scan` overlapping the timer, without adding a lock) and also serves the lookup. The per-entity loops are background work, so leave them. If you want to trim them, `checkPayrollDue` collapses to one `payrollRecord.findMany({ where: { month: lastMonthStart }, select: { employee_id: true } })` plus `employees.findMany({ where: { profile: { is_active: true } } })`. That is optional.
- **Migration risk:** The unique index fails if duplicates already exist. Clean them first:
  ```sql
  UPDATE "Alerts" SET status = 'RESOLVED', resolved_at = now()
  WHERE status = 'ACTIVE' AND related_id IS NOT NULL AND id NOT IN (
    SELECT DISTINCT ON (type, related_id) id FROM "Alerts"
    WHERE status = 'ACTIVE' AND related_id IS NOT NULL ORDER BY type, related_id, created_at);
  ```
  A manual `POST /alerts` with a `related_id` that already has an ACTIVE alert now returns 409. The mobile outbox already treats 409 as "already landed". Existing quirk, unchanged by this fix: probation, payroll-not-generated and negative-pattern alerts all use `(EMPLOYEE, employee.id)`, so only one of them can be ACTIVE per employee.
- **Effort:** S

### PERF-07: Sales summaries bind all-time ID lists
- **Fix:** Skip the id list when the summary is unfiltered, which is the common Sales-page load.
  ```diff
  // src/services/sale.service.ts:50-66 (same change in bird-sale.service.ts:44-57)
            const where = buildWhere(query);
  +         const unfiltered = Object.keys(where).length === 0;
            const [aggregate, ids] = await Promise.all([
                prisma.sale.aggregate({ ... }),
  -             prisma.sale.findMany({ where, select: { id: true } }),
  +             unfiltered ? [] : prisma.sale.findMany({ where, select: { id: true } }),
            ]);
            const paid = await prisma.payment.aggregate({
  -             where: { ref_type: "SALE", ref_id: { in: ids.map((row) => row.id) } },
  +             where: { ref_type: "SALE", ...(!unfiltered && { ref_id: { in: ids.map((row) => row.id) } }) },
  ```
- **Why this is the simplest:** It is a conditional, not a raw SQL join. Sales are append-only (never deleted), so every SALE payment belongs to some sale. A filtered summary still binds its filtered ids, which at farm scale is hundreds per year, far below the 65,535-parameter limit. `paidByRef` (payment.service.ts:166) stays unpaginated. Scoping it to page ids would need a coordinated web change for a few KB.
- **Migration risk:** None. Same response.
- **Effort:** S

### PERF-08: Consumption.item_id unindexed
- **Fix:** Shared index migration: `@@index([item_id, date])` on Consumption.
- **Why this is the simplest:** One index covers the item filter, the item delete guard and the FEED join.
- **Migration risk:** Additive.
- **Effort:** S

### PERF-09: Ledger list includes full Item rows
- **Fix:**
  ```diff
  // src/services/stock-ledger.service.ts:39
  -                include: { item: true },
  +                include: { item: { select: { id: true, name: true, unit: true } } },
  ```
  The `occurred_at` index for the unfiltered sort is already added under PERF-05.
- **Why this is the simplest:** One `select`.
- **Migration risk:** Response shrinks. Web `stock-ledger-tab.tsx:52,70` reads only `item.name` and `item.unit`. Its `StockLedgerEntry.item: Item` type (`web/src/pages/inventory/types.ts:201`) is wider than the data, which is harmless, but narrow it to `Pick<Item, "id"|"name"|"unit">` to be honest.
- **Effort:** S

### PERF-10: Dashboard loads whole relations to count
- **Fix:**
  ```diff
  // src/services/analytics.service.ts:22-25, :34-36
  -               prisma.houses.findMany({ where: { is_active: true }, include: { batchHouseBalances: true } }),
  +               prisma.houses.findMany({
  +                   where: { is_active: true },
  +                   select: { _count: { select: { batchHouseBalances: { where: { quantity: { gt: 0 } } } } } },
  +               }),
  ...
  -       const housesOccupied = houses.filter((h) => h.batchHouseBalances.some((b) => b.quantity > 0)).length;
  +       const housesOccupied = houses.filter((h) => h._count.batchHouseBalances > 0).length;
  ```
  ```diff
  // :105-108
                prisma.weightRecords.findMany({
                    where: { batch_id: { in: batchIds } },
                    orderBy: { date: "desc" },
  +                 select: { batch_id: true, average_wt_grams: true, date: true },
                }),
  ```
- **Why this is the simplest:** A filtered relation count, plus a `select` of the two columns used at :132-133. `distinct` would not help: without the `nativeDistinct` preview, Prisma still fetches every row and de-duplicates in memory.
- **Migration risk:** None. Same response.
- **Effort:** S

### PERF-11: Unused indexes
- **Fix:** In the shared index migration:
  ```diff
  // model Profiles
  -  @@index([role])
  // model StockTransfer
  -  @@index([to_location_type, to_location_id])
  // model Expense
  -  @@index([cost_type])
  ```
  Keep `StockLedger @@index([ref_type, ref_id])`, and add `// kept for traceability: "ledger rows for this purchase line/transfer"`. DES-04 makes `ref_id` meaningful per type, and it is the only way back from a ledger row's source.
- **Why this is the simplest:** Deleting dead indexes.
- **Migration risk:** `DROP INDEX` is instant. Confirm in prod first: `SELECT indexrelname, idx_scan FROM pg_stat_user_indexes WHERE indexrelname IN ('Profiles_role_idx','StockTransfer_to_location_type_to_location_id_idx','Expense_cost_type_idx');` should show `idx_scan = 0`.
- **Effort:** S

### PERF-12: Device auth writes last_seen_at every request
- **Fix:** Accept. If you want it anyway, make it a one-line throttle:
  ```diff
  // src/services/device.service.ts:85-88
  -        await prisma.device.update({ where: { id: device.id }, data: { last_seen_at: new Date() } });
  +        await prisma.device.updateMany({
  +            where: { id: device.id, OR: [{ last_seen_at: null }, { last_seen_at: { lt: new Date(Date.now() - 60_000) } }] },
  +            data: { last_seen_at: new Date() },
  +        });
  ```
- **Why this is the simplest:** A few phones POST a sale every few minutes, so one primary-key UPDATE per POST costs nothing measurable. Not worth fixing at this scale.
- **Migration risk:** None.
- **Effort:** S

### PERF-13: Missing indexes on low-volume tables
- **Fix:** None now; accept and document. Revisit when any of these tables passes about 10^5 rows, using `SELECT relname, seq_scan, n_live_tup FROM pg_stat_user_tables ORDER BY seq_scan DESC;`. At that point the candidates are Sale(customer_id), Sale(sale_date), BirdSale(customer_id), BirdSale(sale_date), Expense(date), Purchase(purchase_date), Payment(payment_date), PurchaseItem(expiration_date), AssetDepreciation(batch_id), WeightRecords(house_id) and StockUnit(created_at). Alerts is covered by PERF-06.
- **Why this is the simplest:** A sequential scan of a few thousand rows is sub-millisecond. Each index costs writes for no read benefit yet.
- **Migration risk:** n/a
- **Effort:** S

### SEC-09: token_hash returned by device endpoints
- **Fix:**
  ```diff
  // src/services/device.service.ts:92-103
  +const deviceSelect = {
  +    id: true, profile_id: true, label: true, platform: true, last_seen_at: true, revoked_at: true, created_at: true,
  +    profile: { select: { id: true, name: true } },
  +} as const;
       async listDevices() {
  -        return prisma.device.findMany({ orderBy: { created_at: "desc" }, include: { profile: { select: { id: true, name: true } } } });
  +        return prisma.device.findMany({ orderBy: { created_at: "desc" }, select: deviceSelect });
       },
  ...
  -        return prisma.device.update({ where: { id }, data: { revoked_at: new Date() } });
  +        return prisma.device.update({ where: { id }, data: { revoked_at: new Date() }, select: deviceSelect });
  ```
- **Why this is the simplest:** One `select`.
- **Migration risk:** None. Web `devices-tab.tsx` reads `profile.name`, `last_seen_at` and `revoked_at`, never `token_hash`.
- **Effort:** S

### SEC-10: Plaintext pairing codes; spoofable rate-limit key
- **Fix:** Store `sha256(code)` in the same column, using the existing `hashToken`.
  ```diff
  // src/services/device.service.ts:22-31, :42-45, :59-61
       async createPairingCode(profile_id: string) {
  +        const code = newCode();
           const created = await prisma.pairingCode.create({
  -            data: { code: newCode(), profile_id, expires_at: ... },
  +            data: { code: hashToken(code), profile_id, expires_at: ... },
           });
  -        return { code: created.code, expires_at: created.expires_at };
  +        return { code, expires_at: created.expires_at };
  ...
  -        const pairing = await tx.pairingCode.findUnique({ where: { code }, ... });
  +        const pairing = await tx.pairingCode.findUnique({ where: { code: hashToken(code) }, ... });
  ...
  -        await tx.pairingCode.update({ where: { code }, data: { used_at: new Date() } });
  +        await tx.pairingCode.update({ where: { code: pairing.code }, data: { used_at: new Date() } });
  ```
  For the rate limiter (App.ts:68), key on the socket address. Bun is the primary runtime (index.ts:8-12):
  ```diff
  +import { getConnInfo } from "hono/bun";
  ...
  -        keyGenerator: (c) => c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown",
  +        keyGenerator: (c) => getConnInfo(c).remote.address ?? "unknown",
  ```
  If production sits behind a reverse proxy, keep the XFF key instead and have the proxy overwrite the header (`proxy_set_header X-Forwarded-For $remote_addr;`), so clients cannot inject it.
- **Why this is the simplest:** It reuses `hashToken`, the same column and no schema change. `getConnInfo` is built into Hono.
- **Migration risk:** Codes issued before the deploy stop redeeming. They live 10 minutes, so re-issue any that are pending. `getConnInfo` from `hono/bun` throws under the Node fallback. If the Node path is used anywhere, import from `@hono/node-server/conninfo` there instead.
- **Effort:** S

### SEC-12: Unvalidated Cloudinary folder
- **Fix:**
  ```diff
  // src/controllers/upload.controller.ts:13-14
  -            const folder = c.req.query("folder") || "employees";
  -            return sendSuccess(c, buildUploadSignature(folder), "Upload signature issued");
  +            // ponytail: one folder today; add an allow-list when a second upload kind exists.
  +            return sendSuccess(c, buildUploadSignature("employees"), "Upload signature issued");
  ```
- **Why this is the simplest:** The only caller (`web/src/components/shared/image-upload.tsx:27,55`) always uses the default `"employees"`, so the parameter has no legitimate use. An allow-list with one entry is the same thing with more code.
- **Migration risk:** None. The web still sends `?folder=employees`, which is simply ignored.
- **Effort:** S

### PERF-14: Deep includes on list endpoints
- **Fix:** Optional. Replace whole-row includes with selects only where payloads get large:
  ```diff
  // src/services/stock-house-allocation.service.ts:17-20
  -                include: {
  -                    house: true,
  -                    stock_unit: { include: { purchase_item: { include: { item: true } } } },
  -                },
  +                include: {
  +                    house: { select: { id: true, name: true } },
  +                    stock_unit: { select: { id: true, status: true, purchase_item: { select: { id: true, item: { select: { id: true, name: true, unit: true } } } } } },
  +                },
  ```
  Before shipping, grep `web/src/pages/inventory/stock-allocation-tab.tsx` and `types.ts:169` for every nested field it reads, and add any that are missing. To settle the "needs verification" on StockUnit's nested `take: 1`, run the list once with `new PrismaClient({ adapter, log: ["query"] })` and see whether the allocations query has a per-parent `LIMIT` or fetches everything. At 100-row pages either way is acceptable.
- **Why this is the simplest:** Selects only, no DTO layer. Low value. Do it only if a list shows up as slow.
- **Migration risk:** Response shape shrinks. This needs the web grep above.
- **Effort:** S

### PERF-15: Purchase create runs per-line queries in the transaction
- **Fix:** None; accept. If it ever matters, hoist `toBaseQuantity`'s two reads into one `item.findMany` plus one `itemUnit.findMany` before the loop, then use `createManyAndReturn` for lines and `createMany` for ledger rows (the pattern `SaleService.create` already uses).
- **Why this is the simplest:** A 20-line purchase is rare, and about 80 round trips on a LAN DB take around 50 ms. Batching adds code for no user-visible gain today.
- **Migration risk:** n/a
- **Effort:** S

### PERF-16: revenueVsExpenses fires up to 72 aggregates
- **Fix:** Use three range reads over the whole window, bucketed by month in JS, the same pattern every trend function in this file already uses.
  ```diff
  // src/services/analytics.service.ts:525-552
  -       const rows = await Promise.all(windows.map(async ({ label, monthStart, monthEnd }) => { ...3 aggregates... }));
  +       const from = windows[windows.length - 1]!.monthStart;
  +       const to = windows[0]!.monthEnd;
  +       const range = { gte: from, lt: to };
  +       const [sales, birdSales, expenses] = await Promise.all([
  +           prisma.sale.findMany({ where: { sale_date: range }, select: { sale_date: true, total: true } }),
  +           prisma.birdSale.findMany({ where: { sale_date: range }, select: { sale_date: true, total_amount: true } }),
  +           prisma.expense.findMany({ where: { date: range }, select: { date: true, amount: true } }),
  +       ]);
  +       const zero = () => ({ revenue: new Prisma.Decimal(0), expenses: new Prisma.Decimal(0) });
  +       const byMonth = new Map(windows.map((w) => [w.label, zero()]));
  +       const key = (d: Date) => d.toISOString().slice(0, 7);
  +       for (const s of sales) byMonth.get(key(s.sale_date))!.revenue = byMonth.get(key(s.sale_date))!.revenue.plus(s.total);
  +       for (const s of birdSales) byMonth.get(key(s.sale_date))!.revenue = byMonth.get(key(s.sale_date))!.revenue.plus(s.total_amount);
  +       for (const e of expenses) byMonth.get(key(e.date))!.expenses = byMonth.get(key(e.date))!.expenses.plus(e.amount);
  +       const rows = windows.map((w) => ({ month: w.label, revenue: byMonth.get(w.label)!.revenue.toString(), expenses: byMonth.get(w.label)!.expenses.toString() }));
  ```
- **Why this is the simplest:** Three queries instead of 3×N, with no raw SQL and the house style kept. Rows over 24 months at one farm number in the low thousands.
- **Migration risk:** None. Same response.
- **Effort:** S

### PERF-17: Pre-checks outside the writes they guard
- **Fix:**
  - **Batch close** (batch.service.ts:127-146): move the read into the transaction as a claim.
    ```diff
    -       const batch = await prisma.batches.findUnique({ where: { id }, include: { houseBalances: true } });
    -       if (!batch) throw ...; if (batch.status !== "RUNNING") throw ...;
    -       const remaining = ...; if (remaining !== 0 && !data.force) throw ...;
            return prisma.$transaction(async (tx) => {
    +           const claimed = await tx.batches.updateMany({ where: { id, status: "RUNNING" }, data: { status: data.status, actual_end_date: new Date() } });
    +           if (claimed.count === 0) throw (await tx.batches.findUnique({ where: { id } })) ? AppError.conflict("Batch is not RUNNING") : AppError.notFound("Batch");
    +           const balances = await tx.batchHouseBalance.findMany({ where: { batch_id: id } });
    +           const remaining = balances.reduce((s, b) => s + b.quantity, 0);
    +           if (remaining !== 0 && !data.force) throw AppError.conflict(`Batch still has ${remaining} live birds ...`); // rolls back the claim
    ```
    Then remove the later `tx.batches.update` (:154-158) and re-read with `findUniqueOrThrow({ where: { id }, include })`.
  - **Stock-unit relocate** (stock-unit.service.ts:143-168): wrap :143-168 in `prisma.$transaction(async (tx) => { await tx.$executeRaw\`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))\`; ...latest read + create via tx... })`.
  - **Payroll generate** (payroll-record.service.ts:146): wrap the create.
    ```diff
    -        return prisma.payrollRecord.create({ data: { ... } });
    +        try {
    +            return await prisma.payrollRecord.create({ data: { ... } });
    +        } catch (err) { return handlePrismaWriteError(err); }  // P2002 -> 409
    ```
- **Why this is the simplest:** Each one is the claim-or-catch pattern already used elsewhere in this file set. The relocate fix uses the shared one-line advisory lock (see the conventions at the top).
- **Migration risk:** None.
- **Effort:** S

### PERF-18: Balances recomputed from full history
- **Fix:** None; accept and document. PERF-03 and PERF-05 keep these sums index-driven. Add balance snapshots (an opening-balance row per item and location plus the delta since) only if `getItemLocationBalance` shows up in slow-query logs, which at one farm is years away.
- **Why this is the simplest:** A snapshot table means a second source of truth plus a job that maintains it. The current code is correct and fast enough.
- **Migration risk:** n/a
- **Effort:** S

---

## Needs a migration plan

### DES-04: Polymorphic references unchecked
- **Fix, in three parts:**
  1. **Ship now: validate the transfer destination.** One line.
     ```diff
     // src/services/transfer.service.ts:46
                     await assertLocationExists(tx, data.from_location_type, data.from_location_id);
     +               await assertLocationExists(tx, data.to_location_type, data.to_location_id);
     ```
  2. **Make `PaymentInstrument.owner_id` a real FK to Profiles.** Every `owner_type` is a `UserRole`, and every role is one Profiles row, so `owner_type` is a projection of `Profiles.role`.
     ```diff
     // prisma/schema.prisma, model PaymentInstrument (:1279-1280)
        owner_type UserRole
        owner_id   String
     +  owner      Profiles @relation(fields: [owner_id], references: [id])
     ...
     +  @@index([owner_id])
     // model Profiles: add back-relation
     +  paymentInstruments      PaymentInstrument[]
     ```
  3. **Write down the `ref_id` meaning per type; no rename.** Add a schema comment on StockLedger: `// ref_type PURCHASE -> PurchaseItem.id (one ledger row per line); on Payment, PURCHASE -> Purchase.id.` Renaming the enum value would touch stored rows and two clients for no functional gain.
- **Why this is the simplest:** Part 1 closes the stock-loss bug with one line. Part 2 swaps an unchecked id for a real FK, which is simpler than a validation call. Per-target FK columns on StockLedger/StockTransfer (`from_warehouse_id`/`from_house_id`) would be a wide migration over the largest table for a bug that part 1 already prevents, so skip them.
- **Migration risk:** Part 2 fails if any `owner_id` is not a Profiles id. The web form takes a free-typed "Owner id" (`instrument-form-dialog.tsx:159-164`), so some rows may hold a Customers/Suppliers id. Pre-check:
  ```sql
  SELECT pi.id, pi.owner_type, pi.owner_id FROM "PaymentInstrument" pi
  LEFT JOIN "Profiles" p ON p.id = pi.owner_id WHERE p.id IS NULL;
  -- remap role-table ids to their profile:
  UPDATE "PaymentInstrument" pi SET owner_id = c.profile_id FROM "Customers" c WHERE c.id = pi.owner_id;  -- repeat for Suppliers/Employees/Admins/Doctors
  ```
  Find stock already moved to phantom locations:
  ```sql
  SELECT * FROM "StockTransfer" t WHERE (t.to_location_type = 'HOUSE' AND NOT EXISTS (SELECT 1 FROM "Houses" h WHERE h.id = t.to_location_id))
     OR (t.to_location_type = 'WAREHOUSE' AND NOT EXISTS (SELECT 1 FROM "Warehouses" w WHERE w.id = t.to_location_id));
  ```
  Repair any hits with an InventoryAdjustment at the real location. The response shape does not change. The web should become an owner picker instead of a raw id field, but that is cosmetic.
- **Effort:** M

### DES-07: WeightRecords uniqueness doesn't hold
- **Fix:**
  ```diff
  // prisma/schema.prisma, model WeightRecords (:1039, :1046)
  -  date             DateTime
  +  date             DateTime @db.Date
  ...
     @@unique([batch_id, house_id, date])
  +  @@unique([house_id, date], where: raw("batch_id IS NULL"), map: "WeightRecords_house_date_nobatch_key")
  ```
- **Why this is the simplest:** Two schema lines. `@db.Date` makes "same day" mean the same key. The partial unique covers the NULL-batch rows that the composite unique cannot see. `NULLS NOT DISTINCT` (PG15+) is not expressible in Prisma, and making `batch_id` required would forbid weighing an empty house.
- **Migration risk:** The type change truncates times. That loses data, but only the time-of-day nobody reads. The migration fails if two samples already share a day. Pre-check:
  ```sql
  SELECT batch_id, house_id, date::date, count(*) FROM "WeightRecords" GROUP BY 1,2,3 HAVING count(*) > 1;
  ```
  Delete or merge duplicates first (keep the larger `sample_size`). Check that Prisma generates `ALTER COLUMN "date" SET DATA TYPE DATE` rather than drop and re-add. Timezone: the date part is taken in UTC, so a sample entered before 06:00 Dhaka time with a full timestamp lands on the previous day. Have clients send `YYYY-MM-DD`. `latest_weight_date` in analytics now serialises as midnight UTC, which is the same shape.
- **Effort:** S

### DES-09: FK delete actions contradict history preservation
- **Fix:** Switch history-bearing FKs to `Restrict`. Leave the config cascades as they are (ItemUnit, ItemOrganization, Item↔Suppliers).
  ```diff
  // prisma/schema.prisma
  // InventoryAdjustment (:1089, :1091, :1093)
  -  item      Item        @relation(fields: [item_id], references: [id], onDelete: Cascade)
  +  item      Item        @relation(fields: [item_id], references: [id], onDelete: Restrict)
  -  warehouse Warehouses? @relation(fields: [warehouse_id], references: [id], onDelete: Cascade)
  +  warehouse Warehouses? @relation(fields: [warehouse_id], references: [id], onDelete: Restrict)
  -  house     Houses?     @relation(fields: [house_id], references: [id], onDelete: Cascade)
  +  house     Houses?     @relation(fields: [house_id], references: [id], onDelete: Restrict)
  // StockHouseAllocation (:890) -- today defaults to SET NULL, and NULL means "returned to warehouse"
  -  house             Houses?        @relation(fields: [house_id], references: [id])
  +  house             Houses?        @relation(fields: [house_id], references: [id], onDelete: Restrict)
  // BatchHouseAllocation (:690, :692, :694)
  -  batch      Batches @relation(fields: [batch_id], references: [id], onDelete: Cascade)
  +  batch      Batches @relation(fields: [batch_id], references: [id], onDelete: Restrict)
  -  ... onDelete: SetNull)   (from_house, to_house)
  +  ... onDelete: Restrict)
  // EmployeeTaskAssignment (:1413) -- defaults to SET NULL; this also closes DES-15's house-delete gap
  -  house         Houses? @relation(fields: [house_id], references: [id])
  +  house         Houses? @relation(fields: [house_id], references: [id], onDelete: Restrict)
  // Employees/Admins/Customers/Suppliers/Doctors .profile (:508, :567, :575, :589, :604)
  -  profile  Profiles @relation(fields: [profile_id], references: [id], onDelete: Cascade)
  +  profile  Profiles @relation(fields: [profile_id], references: [id], onDelete: Restrict)
  ```
  Then remove the now-false comments at house.service.ts:178-181 and item.service.ts:134-136, which say the FKs "won't stop us".
- **Why this is the simplest:** It changes FK actions in place. The DB then enforces what the count guards try to, races included, and no new code is needed. The intent is already written in the schema (`:465` "never hard-delete a Profile", house `:637`) and in item.service.ts:134-138, so no product decision is needed.
- **Migration risk:** Prisma emits `DROP CONSTRAINT` plus `ADD CONSTRAINT ... FOREIGN KEY` per relation. Re-adding validates existing rows under a SHARE ROW EXCLUSIVE lock. This is fast on these table sizes and cannot fail, because existing rows already satisfy the FK. No data changes. No delete path depends on these cascades. I grepped every `.delete(`/`deleteMany(` in src: house, item and warehouse removes count first, stock-unit remove deletes its allocations explicitly, and there are no Profile or Batch deletes. A racing delete now gets P2003, which `handlePrismaWriteError` maps to a 400 with a slightly odd "does not reference" message. That is acceptable for a race.
- **Effort:** S

### DES-10: Balance guards race; no non-negative CHECK; force-close zeroes out of band
- **Fix:**
  1. **Birds: conditional decrement instead of read-check-update.** Apply it in all three writers: mortality-log.service.ts:32-56, bird-sale.service.ts:97-136 and batch-house-allocation.service.ts:51-62.
     ```diff
     -   const balance = await tx.batchHouseBalance.findUnique({ where: { batch_id_house_id: { batch_id, house_id } } });
     -   if (!balance || balance.quantity < n) throw AppError.conflict("...");
     -   ...
     -   await tx.batchHouseBalance.update({ where: { id: balance.id }, data: { quantity: { decrement: n } } });
     +   const { count } = await tx.batchHouseBalance.updateMany({
     +       where: { batch_id, house_id, quantity: { gte: n } },
     +       data: { quantity: { decrement: n } },
     +   });
     +   if (count === 0) throw AppError.conflict("...");   // same messages as today
     ```
     Do the decrement before the event-row insert, so a conflict writes nothing.
  2. **Stock and payments: one-line advisory lock** before the read that guards the write.
     ```diff
     // src/lib/stock-balance.ts:120 (getItemLocationBalance -- every stock-drawing writer goes through it)
     +   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${item_id}:${location_id}`}, 0))`;
         const sums = await tx.stockLedger.groupBy({ ... });
     // src/services/payment.service.ts:78 (outstandingWithin)
     +   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ref_id}, 0))`;
     ```
     Also update the stale comments at stock-balance.ts:110-114 and payment.service.ts:121-124.
  3. **DB backstop:**
     ```sql
     ALTER TABLE "BatchHouseBalance" ADD CONSTRAINT "BatchHouseBalance_quantity_nonneg" CHECK (quantity >= 0);
     ```
  4. **Force-close writes events instead of zeroing.** batch.service.ts:145-147; the controller passes `recorded_by_id: await getActorId(c)`, as batch.controller.ts:34 already does for create.
     ```diff
     -           if (remaining !== 0) {
     -               await tx.batchHouseBalance.updateMany({ where: { batch_id: id }, data: { quantity: 0 } });
     -           }
     +           for (const b of balances.filter((b) => b.quantity > 0)) {
     +               await tx.batchHouseAllocation.create({ data: {
     +                   batch_id: id, from_house_id: b.house_id, quantity: b.quantity, reason: "ADJUSTMENT",
     +                   recorded_by_id: data.recorded_by_id, idempotency_key: `force-close:${id}:${b.house_id}`,
     +               } });
     +               await tx.batchHouseBalance.update({ where: { id: b.id }, data: { quantity: 0 } });
     +           }
     ```
- **Why this is the simplest:** For birds, the cached balance row exists, so the guard and the write become one atomic `UPDATE ... WHERE quantity >= n` with no lock. For stock and payments, the balance is a sum and there is no row to lock. A transaction-scoped advisory lock keyed on what is being drawn from is one line at the single choke point, and it is far simpler than switching those transactions to SERIALIZABLE and adding retry loops. The CHECK costs nothing. Force-close reuses the existing ADJUSTMENT allocation semantics (NULL `to_house` = birds removed).
- **Migration risk:** The CHECK fails if any balance is already negative. Pre-check:
  ```sql
  SELECT * FROM "BatchHouseBalance" WHERE quantity < 0;
  -- and verify the cache matches its events (drift from past force-closes is expected):
  SELECT b.id, b.quantity,
    COALESCE((SELECT sum(quantity) FROM "BatchHouseAllocation" a WHERE a.batch_id=b.batch_id AND a.to_house_id=b.house_id),0)
   -COALESCE((SELECT sum(quantity) FROM "BatchHouseAllocation" a WHERE a.batch_id=b.batch_id AND a.from_house_id=b.house_id),0)
   -COALESCE((SELECT sum(count_died) FROM "MortalityLog" m WHERE m.batch_id=b.batch_id AND m.house_id=b.house_id),0)
   -COALESCE((SELECT sum(birds_count) FROM "BirdSale" s WHERE s.batch_id=b.batch_id AND s.house_id=b.house_id),0) AS derived
  FROM "BatchHouseBalance" b;
  ```
  For past force-closed batches, write a backfill ADJUSTMENT row per house (with the same `force-close:` key) so the events reconcile. Check for already-overpaid refs:
  ```sql
  SELECT ref_type, ref_id FROM "Payment" GROUP BY 1,2 HAVING sum(amount) > (...owed...)  -- per ref_type join, as in owedForRef
  ```
  `CloseBatchInput` gains `recorded_by_id` (stamped server-side), so the API body is unchanged.
- **Effort:** M

### DES-12: Row invariants live only in app code
- **Fix:** One raw-SQL migration with CHECKs, plus one partial unique in the schema.
  ```diff
  // prisma/schema.prisma, model EmployeePayoutAccount (:1370)
     @@index([employee_id, active_to])
  +  @@unique([employee_id], where: raw("active_to IS NULL"), map: "EmployeePayoutAccount_one_active_key")
  ```
  ```sql
  -- appended to the --create-only migration
  ALTER TABLE "Employees" ADD CONSTRAINT "Employees_reference_xor"
    CHECK (reference_employee_id IS NULL OR (reference_name IS NULL AND reference_phone IS NULL AND reference_address IS NULL));
  ALTER TABLE "EmployeeTaskAssignment" ADD CONSTRAINT "EmployeeTaskAssignment_location_xor"
    CHECK (house_id IS NULL OR location_note IS NULL);
  ALTER TABLE "PerformanceScoreEntry" ADD CONSTRAINT "PSE_other_approved"  CHECK (criterion <> 'OTHER' OR approved_by_id IS NOT NULL);
  ALTER TABLE "PerformanceScoreEntry" ADD CONSTRAINT "PSE_notice_required" CHECK (points > -4 OR notice_doc_url IS NOT NULL);
  ALTER TABLE "PerformanceScoreEntry" ADD CONSTRAINT "PSE_void_reason"     CHECK (status <> 'VOIDED' OR void_reason IS NOT NULL);
  ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_delta"
    CHECK (adjustment_quantity = quantity_after - quantity_before);
  ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_one_location"
    CHECK (num_nonnulls(warehouse_id, house_id) = 1);
  ALTER TABLE "BirdSale" ADD CONSTRAINT "BirdSale_sex_sum"
    CHECK (male_count IS NULL OR female_count IS NULL OR male_count + female_count = birds_count);
  ALTER TABLE "Payment"   ADD CONSTRAINT "Payment_amount_pos"   CHECK (amount > 0);
  ALTER TABLE "Expense"   ADD CONSTRAINT "Expense_amount_pos"   CHECK (amount > 0);
  ALTER TABLE "StockLedger"    ADD CONSTRAINT "StockLedger_qty_pos"    CHECK (quantity > 0);
  ALTER TABLE "Consumption"    ADD CONSTRAINT "Consumption_qty_pos"    CHECK (quantity > 0);
  ALTER TABLE "PurchaseItem"   ADD CONSTRAINT "PurchaseItem_qty_pos"   CHECK (quantity > 0);
  ALTER TABLE "SaleItem"       ADD CONSTRAINT "SaleItem_qty_pos"       CHECK (quantity > 0);
  ALTER TABLE "StockTransfer"  ADD CONSTRAINT "StockTransfer_qty_pos"  CHECK (quantity > 0);
  ALTER TABLE "BatchHouseAllocation" ADD CONSTRAINT "BHA_qty_pos"      CHECK (quantity > 0);
  ALTER TABLE "MortalityLog"   ADD CONSTRAINT "MortalityLog_count_pos" CHECK (count_died > 0);
  ALTER TABLE "BirdSale"       ADD CONSTRAINT "BirdSale_count_pos"     CHECK (birds_count > 0);
  ```
  The ACTIVE-alert rule is covered by PERF-06. `PayrollRecord.month` is covered by DES-19.
- **Why this is the simplest:** Each rule becomes one declarative line, which beats re-implementing it in every service, script and manual fix. Plain CHECKs need no triggers. The payout-account partial unique closes the race in `create` (employee-payout-account.service.ts:61-66) with no app change: two concurrent creates make one of them fail with P2002, which maps to 409.
- **Migration risk:** Every constraint fails if existing rows violate it. Run each predicate negated first, e.g.:
  ```sql
  SELECT id FROM "Employees" WHERE NOT (reference_employee_id IS NULL OR (reference_name IS NULL AND reference_phone IS NULL AND reference_address IS NULL));
  SELECT employee_id FROM "EmployeePayoutAccount" WHERE active_to IS NULL GROUP BY 1 HAVING count(*) > 1;
  SELECT id FROM "InventoryAdjustment" WHERE num_nonnulls(warehouse_id, house_id) <> 1;
  -- ...one per constraint
  ```
  Repair or close the offenders: keep the newest active payout account and set `active_to` on the rest. Then check one app path. `EmployeeService.update` connects `reference_employee` without nulling `reference_name/phone/address` (employee.service.ts:293-297). Add `reference_name: null, reference_phone: null, reference_address: null` to that branch, or the new CHECK will reject a form switch from "outsider" to "employee". The task-assignment service already nulls the other field (task-assignment.service.ts:89-92).
- **Effort:** M

### DES-16: String columns that should be enums
- **Fix:**
  ```diff
  // prisma/schema.prisma
  +enum IngestStatus { PENDING CONFIRMED DISMISSED }
  +enum IngestPortion { main cull }
   model IngestedSale {
  -  portion          String // "main" | "cull"
  +  portion          IngestPortion
  -  status           String    @default("PENDING") // PENDING | CONFIRMED | DISMISSED
  +  status           IngestStatus @default(PENDING)
  ```
  Leave `source` as a String. It has one value, and an enum would only add a migration the day a second source appears. Leave `Medications.dosage` (String, e.g. "2 ml/L") and `Vaccinations.dosage` (Int) as they are. Unifying them would lose medication text or invent units, so accept the mismatch. `InventoryAdjustment.reason` is handled by DES-14.
- **Why this is the simplest:** Two enums for the two columns the code actually branches on.
- **Migration risk:** For a String→enum change, Prisma generates `DROP COLUMN` + `ADD COLUMN`, which is **data loss**. Use `--create-only` and replace the generated SQL with:
  ```sql
  ALTER TABLE "IngestedSale" ALTER COLUMN status DROP DEFAULT,
    ALTER COLUMN status TYPE "IngestStatus" USING status::"IngestStatus",
    ALTER COLUMN status SET DEFAULT 'PENDING',
    ALTER COLUMN portion TYPE "IngestPortion" USING portion::"IngestPortion";
  ```
  Pre-check: `SELECT DISTINCT status, portion FROM "IngestedSale";` must return only the listed values. The TS literals in ingest.service.ts already match. The JSON shape is unchanged (strings).
- **Effort:** S

### DES-18: Missing updated_at/created_at
- **Fix:** Add only where a mutable row's last-change time is actually useful: the money and accountability rows.
  ```diff
  // models StockUnit, PaymentInstrument, EmployeePayoutAccount, PayrollPayout, PerformanceScoreEntry
  +  updated_at DateTime @default(now()) @updatedAt
  ```
  Skip the rest (Asset, Warehouses, Device, Organization, and the `created_at` gaps on link tables) until mobile incremental sync actually needs them.
- **Why this is the simplest:** It is five columns, not twelve. No consumer exists yet: mobile does not sync incrementally. Not worth more at this scale.
- **Migration risk:** Prisma's generated `ADD COLUMN ... NOT NULL` without a default fails on non-empty tables. The `@default(now())` above prevents that, and existing rows get the migration time. That is not a true "last changed" value, so document it.
- **Effort:** S

### DES-19: Type and precision issues
- **Fix:**
  ```diff
  // Alerts (:1465-1466) -- @db.Date drops the time the code writes
  -  issued_at       DateTime?         @db.Date
  -  resolved_at     DateTime?         @db.Date
  +  issued_at       DateTime?
  +  resolved_at     DateTime?
  // StockLedger (:1074) -- per-DOSE cost rounds to 2 dp
  -  unit_cost       Decimal?       @db.Decimal(10, 2)
  +  unit_cost       Decimal?       @db.Decimal(14, 4)
  // PayrollRecord (:1328)
  -  month              DateTime // normalized to first-of-month
  +  month              DateTime @db.Date // first-of-month, UTC
  ```
  Also fix the false comment in `src/lib/stock-value.ts:5-7` that says `unit_cost` is "never populated" (purchase.service.ts:158 writes it). Leave `init_chicks_avg_wt Float` and `rating Float? @default(0)` as they are. Web renders `customer.rating.toFixed(1)` (customers-list-page.tsx:39), so switching to Decimal would make it a string and break that.
- **Why this is the simplest:** Three type changes, each a widening or a lossless cast. The others are cosmetic and would cost client changes.
- **Migration risk:** `date → timestamp` and `Decimal(10,2) → (14,4)` are safe widenings. Past alerts keep a midnight time. `timestamp → date` on `month` is lossless only if every value is UTC midnight on the 1st. Pre-check:
  ```sql
  SELECT id, month FROM "PayrollRecord" WHERE month <> date_trunc('month', month);
  ```
  The `@@unique([employee_id, month])` stays valid. The JSON shape is the same (ISO strings), and web shows `unit_cost` as a raw string (stock-ledger-tab.tsx:75), so it gains two decimals.
- **Effort:** S

### DES-20: Nullability and duplicate-value mismatches
- **Fix:**
  ```diff
  // Purchase (:803-804) -- the validator already requires it
  -  warehouse_id   String?
  -  warehouse      Warehouses?   @relation(fields: [warehouse_id], references: [id])
  +  warehouse_id   String
  +  warehouse      Warehouses    @relation(fields: [warehouse_id], references: [id])
  // Houses (:634)
  -  number     Int
  +  number     Int @unique
  ```
  ```diff
  // src/validators/expense.validator.ts:8-15
   export const createExpenseSchema = z.object({ ... })
  +    .refine((d) => d.cost_type !== "DIRECT" || !!d.batch_id, { message: "A DIRECT cost needs a batch", path: ["batch_id"] });
  ```
  ```sql
  ALTER TABLE "Expense" ADD CONSTRAINT "Expense_direct_has_batch" CHECK (cost_type <> 'DIRECT' OR batch_id IS NOT NULL);
  ```
  Accept the rest. The treatment name copies are display text by design (schema :973). Deriving Asset cost from its StockUnit's line is a nice-to-have, and a manual override is sometimes right (for example, freight). Making `Warehouses.name` unique is cosmetic.
- **Why this is the simplest:** It aligns three nullability and uniqueness facts the app already assumes, and leaves alone what is intentional.
- **Migration risk:** Pre-checks:
  ```sql
  SELECT id FROM "Purchase" WHERE warehouse_id IS NULL;             -- backfill to the main warehouse before migrating
  SELECT number, count(*) FROM "Houses" GROUP BY 1 HAVING count(*) > 1;
  SELECT id FROM "Expense" WHERE cost_type = 'DIRECT' AND batch_id IS NULL;  -- reassign to SHARED_PERIOD or attach a batch
  ```
  The Purchase backfill also needs the matching ledger rows tagged: `UPDATE "StockLedger" SET location_type='WAREHOUSE', location_id=<id> WHERE ref_type='PURCHASE' AND location_id IS NULL;`. The house-number uniqueness assumes numbers are farm-wide. If they are per type, use `@@unique([type, number])`.
- **Effort:** S

---

## Needs my decision

### SEC-01: No authentication on /api
- **Fix:** Pick an auth model. The simplest that works:
  - **Option A (recommended):** per-person login for dashboard users only (Admins). Use a password hash on Admins, and on login set a signed, httpOnly session cookie (`hono/cookie` `setSignedCookie` plus `getSignedCookie`; no new dependency). Add one middleware before `app.route("/api", appRoutes)` (App.ts:79) that skips `/api/ingest/v1/pair` and `POST /api/ingest/v1/sales` (the device-token route), and change `getActorId` (current-actor.ts:16-21) to read the session's profile. Every controller already funnels through `getActorId`, so attribution is fixed in one place, as its own comment (:12-14) promises.
  - **Option B:** add role-based access for employees (Manager/Worker) as well. The mobile app is currently a "Who are you?" picker with no password (`mobile/src/app/profile.tsx:41-43`). B means building mobile login too. Larger (L+).
- **Why this is the simplest:** It is one middleware and one `getActorId` change, with no auth library or JWT infrastructure. Signed cookies are built into Hono. CSRF (App.ts:42-44) is already on, which cookie auth needs.
- **Migration risk:** Add `Admins.password_hash String?` (nullable, so existing admins set one on first login via a one-time setup route). Web needs a login page and `credentials: "include"` on `apiFetch`. Mobile keeps working only if Option A exempts its routes. Today mobile calls `/employees`, `/payroll-records`, task and consumption endpoints anonymously. **The real decision is whether the mobile app may stay anonymous on the farm LAN.** If not, this is Option B.
- **Effort:** L

### SEC-02: Pairing codes mintable for any profile
- **Fix:** Once SEC-01 lands, put `/devices/pairing-codes` and `/devices/:id/revoke` behind the admin session. Make sure the new session middleware never accepts a device token, so a device credential cannot act as an admin identity. Separately, decide which profile a phone binds to:
  ```diff
  // src/services/device.service.ts:22 (only if you choose "devices bind to employees")
       async createPairingCode(profile_id: string) {
  +        const target = await prisma.profiles.findUnique({ where: { id: profile_id }, select: { role: true } });
  +        if (target?.role !== "EMPLOYEE") throw AppError.badRequest("Devices pair to an employee profile");
  ```
- **Why this is the simplest:** Gating rides on SEC-01's middleware. There is nothing new to build.
- **Migration risk:** **Decision needed.** The web deliberately pairs phones to **admin** profiles today: `devices-tab.tsx:163` uses `ActorSelect`, which lists only `/admins` (`actor-select.tsx:20`). Restricting pairing to EMPLOYEE breaks that flow, and existing devices bound to admins would keep working unless revoked. Choose between (a) phones keep acting as an admin (accept, and rely on gating plus revocation) and (b) phones act as the employee weighing (change the picker and re-pair). Today a stolen token can only stage sales for human review, so the blast radius is small until auth exists.
- **Effort:** S (after SEC-01)

### DES-03: due_amount read as live balance; create-time paid has no Payment
- **Fix:**
  - **Part A, ship now regardless:** net payments in the dashboard, using the same identity `SaleService.summary` uses.
    ```diff
    // src/services/analytics.service.ts:198-239
    -        const [..., purchasesDue, salesDue, birdSalesDue, instruments] = await Promise.all([
    +        const [..., purchasesDue, salesDue, birdSalesDue, paidByType, instruments] = await Promise.all([
                 ...
    +            prisma.payment.groupBy({ by: ["ref_type"], where: { ref_type: { in: ["PURCHASE", "SALE", "BIRD_SALE"] } }, _sum: { amount: true } }),
             ]);
    +        const paid = (t: string) => paidByType.find((r) => r.ref_type === t)?._sum.amount ?? new Prisma.Decimal(0);
    -        const outstandingReceivables = (salesDue._sum.due_amount ?? 0).plus(birdSalesDue._sum.due_amount ?? 0);
    +        const outstandingReceivables = (salesDue._sum.due_amount ?? new Prisma.Decimal(0)).minus(paid("SALE"))
    +            .plus((birdSalesDue._sum.due_amount ?? new Prisma.Decimal(0)).minus(paid("BIRD_SALE")));
    ...
    -            outstanding_payables: purchasesDue._sum.due_amount ?? new Prisma.Decimal(0),
    +            outstanding_payables: (purchasesDue._sum.due_amount ?? new Prisma.Decimal(0)).minus(paid("PURCHASE")),
    ```
    This is exact because overpayment is refused, and DES-10 makes that refusal race-free.
  - **Part B, needs a decision:** create-time `paid_amount` (purchase.service.ts:93, sale.service.ts:92, bird-sale.service.ts:82) moves cash with no instrument, so `cash_position` never sees it. Options:
    1. **Recommended.** Require `paid_from_instrument_id` (purchases) or `paid_to_instrument_id` (sales) whenever `paid_amount > 0`, and write a Payment row in the same transaction. Store `paid_amount = 0, due_amount = total` so the snapshot does not double-count. This changes the meaning of the stored `paid_amount` for new rows.
    2. Remove `paid_amount` from the create forms. Money only moves through `POST /payments`. Simpler server, but one more step for users.
    3. Accept and document that `cash_position` excludes point-of-sale cash.
- **Why this is the simplest:** Part A is one extra grouped query. Part B option 1 reuses the Payment table and needs no new concept.
- **Migration risk:** Part A has no schema change. Part B cannot be backfilled exactly: past create-time payments name no instrument. The owner can assign them all to a "Cash box" instrument with `INSERT INTO "Payment" ... SELECT ... FROM "Sale" WHERE paid_amount > 0` (and the same for BirdSale and Purchase), then set `paid_amount=0, due_amount=total` on those rows. That is a one-off, owner-approved script. Options 1 and 2 change the web create forms (instrument picker or removed field), and ingest confirm (`confirm-ingested-dialog.tsx:57`) pre-fills `paid_amount`.
- **Effort:** M

### DES-06: Item sales never leave stock
- **Fix:** Choose one:
  1. **Restrict Sale to non-stocked items.** Add a guard in sale.service.ts:83 that rejects lines whose item has any StockLedger history:
     ```ts
     const stocked = await prisma.stockLedger.findFirst({ where: { item_id: { in: data.items.map((i) => i.item_id) } }, select: { item_id: true } });
     if (stocked) throw AppError.badRequest("This item is stock-tracked -- record it as an adjustment (reason: sold) instead");
     ```
     Selling surplus feed then becomes a stock adjustment plus a Sale for the money, which is awkward but honest.
  2. **Post a ledger OUT.** Add `SALE` to `StockReason` and `RefType`, and add `base_quantity Decimal(13,4)` plus `location_type/location_id` to SaleItem. `SaleService.create` then runs, per line, `toBaseQuantity(...,"USABLE")`, then `getItemLocationBalance` (with the DES-10 lock), then `StockLedgerService.record({direction:"OUT", reason:"SALE", ref_type:"SALE", ref_id: saleItem.id, ...})`. Web `sale-create` gets a source-location picker. This replaces `createMany` with per-line creates, since each ledger row needs its line id.
- **Why this is the simplest:** Option 1 is about 3 lines. Option 2 is the correct model but touches the schema (two enum values and two columns), the service and the web form.
- **Migration risk:** **Decision needed: does the farm actually sell stocked items (feed, medicine)?** If yes, choose option 2. Its schema change is additive, with nullable columns for historical SaleItems (they posted no OUT, so leave them). Past feed sales still overstate balances; fix those once with InventoryAdjustments after a physical count. If sales are only manure and culls, choose option 1 and change no schema.
- **Effort:** L (option 2) / S (option 1)

### SEC-07: Fake or missing actor attribution
- **Fix:**
  - **Now, one line:** stop attributing to a deactivated admin.
    ```diff
    // src/lib/current-actor.ts:31-34
         const admin = await prisma.admins.findFirst({
    +        where: { profile: { is_active: true } },
             orderBy: { created_at: "asc" },
    ```
  - **After SEC-01:** add actor columns where state changes record none. Use nullable FKs so the migration is additive, stamped from `getActorId(c)` in each controller:
    ```diff
    // PerformanceScoreEntry
    +  voided_by_id       String?   // + relation to Profiles
    +  acknowledged_by_id String?
    // EmployeePayoutAccount
    +  closed_by_id       String?
    // Device
    +  revoked_by_id      String?
    // Employees
    +  terminated_by_id   String?
    ```
- **Why this is the simplest:** Columns on the rows themselves are simpler than routing every action through AuditLog. Without real identity (SEC-01), though, every new column would just record the same oldest admin, so adding them earlier gains nothing.
- **Migration risk:** Additive nullable columns. Historical rows stay null (unknowable). **Decision needed:** whether `acknowledge` must be done by the employee themselves. If so, it needs employee login (SEC-01 option B), which is a product choice.
- **Effort:** M (after SEC-01)

### DES-15: Soft-delete is display-only; hard deletes contradict docs
- **Fix:** The decision is the policy. Recommended:
  - **Hard delete stays allowed for mistakes only.** DES-09's Restrict FKs make the DB refuse any delete that has history. That fixes both cited cases: the house delete leaving `taskAssignments` behind (now Restrict), and stock-unit delete. For stock units, remove the `deleteMany` of allocations (stock-unit.service.ts:204) so a unit with move history refuses deletion:
    ```diff
    -        await prisma.$transaction([
    -            prisma.stockHouseAllocation.deleteMany({ where: { stock_unit_id: id } }),
    -            prisma.stockUnit.delete({ where: { id } }),
    -        ]);
    +        await prisma.stockUnit.delete({ where: { id } });  // Restrict FK refuses if it has move history
    ```
  - **Reject inactive references on create only where it matters:** Item (purchase, consumption, transfer, sale) and House (consumption, mortality, allocation, bird sale). For example, in `toBaseQuantity` (unit-conversion.ts:19), which every stock writer already calls:
    ```diff
    -    const item = await tx.item.findUnique({ where: { id: item_id }, select: { unit: true } });
    +    const item = await tx.item.findUnique({ where: { id: item_id }, select: { unit: true, is_active: true } });
         if (!item) throw AppError.badRequest("item_id does not reference an existing record");
    +    if (!item.is_active) throw AppError.badRequest("This item is deactivated");
    ```
  - Update docs/system-design-arc.md:146 to say "hard delete only for rows with no history (DB-enforced); otherwise deactivate".
- **Why this is the simplest:** It uses the FKs (DES-09) instead of more guard code, and one check at an existing choke point.
- **Migration risk:** **Decisions needed:** (1) Should the stock-unit delete of a unit that only moved but was never consumed be allowed? The code calls that "just move history". (2) May a deactivated customer or supplier still appear on new sales or purchases, for example to settle a final invoice? (3) Should Doctors and Warehouses get `is_active` columns? I recommend no for now. The API behaviour change is that writes against inactive items return 400. Check mobile pickers filter `is_active`.
- **Effort:** M

### SEC-08: AuditLog barely written, not tamper-proof
- **Fix:**
  - **Append-only at the DB.** One migration, no app change:
    ```sql
    CREATE FUNCTION audit_log_append_only() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'AuditLog is append-only'; END $$;
    CREATE TRIGGER audit_log_no_update_delete BEFORE UPDATE OR DELETE ON "AuditLog"
      FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
    ```
  - **Writers:** add an inline `tx.auditLog.create` (the same shape as employee.service.ts:268-278) at the handful of money and identity mutations: payout create and markPaid (payroll-payout.service.ts), payout-account create and close, instrument update (if SEC-06 still allows some edits), admin create, device pair and revoke. Do not build the generic Prisma-extension writer the docs describe. It needs request-scoped actor context (AsyncLocalStorage) that does not exist yet.
- **Why this is the simplest:** A trigger is the only thing that stops a buggy service and does not depend on DB role setup. About six inline writes cover the actions the finding names. Then correct docs/system-design-arc.md:140-145, which over-promises.
- **Migration risk:** The trigger only blocks UPDATE and DELETE on AuditLog. No code does either today (the audit-log routes are GET only), so nothing breaks. **Decisions needed:** (1) Run the app as a non-owner DB role? The DB owner can still `DROP TRIGGER`; real tamper-proofing is `REVOKE UPDATE, DELETE ON "AuditLog" FROM app_role` with migrations run as the owner. The prod `DATABASE_URL` role still needs to be checked: `SELECT current_user, (SELECT tableowner FROM pg_tables WHERE tablename='AuditLog');`. (2) Which actions must be audited? The list above is the minimum. Audit rows are only as truthful as `getActorId`, so this pairs with SEC-01.
- **Effort:** M

### SEC-11: Ingest idempotency key is global
- **Fix:** Recommended: accept and document. If you choose to scope it:
  ```diff
  // prisma/schema.prisma, model IngestedSale (:1514)
  -  idempotency_key String   @unique
  +  idempotency_key String
  ...
  +  @@unique([device_id, idempotency_key])
  ```
  and in ingest.service.ts:30-33, `findUnique({ where: { device_id_idempotency_key: { device_id: ctx.device_id, idempotency_key } } })`.
- **Why this is the simplest:** Accepting is simplest. `sale_id` is a device-generated UUID, so an accidental cross-device collision is practically impossible. A deliberate one needs a paired device, which is SEC-02's problem.
- **Migration risk:** The schema change itself is safe, since globally unique rows are also unique per device. **Decision needed on the tradeoff:** a phone that is re-paired gets a new `device_id`. If its outbox resends sales it already delivered, a per-device key lets them in as duplicate PENDING rows, which a reviewer could confirm twice. The global key handles that case correctly today. I recommend keeping global.
- **Effort:** S

### DES-17: Dead or misleading schema surface
- **Fix:** Drop what is provably dead:
  ```diff
  -enum ContactMethods { WHATSAPP EMAIL IMO TELEGRAM }
  // PayrollPayout (:1389)
  -  receipt_doc_url   String? // required when method = CASH
  // Doctors (:609)
  -  rating      Float?   @default(0)
  ```
  Leave `PayoutMethod.CASH` (removing an enum value makes Prisma recreate the type) and `Profiles.role`, unless you decide otherwise below.
- **Why this is the simplest:** Deleting dead surface. Each item was grep-verified unused in src, web and mobile per D-18. Re-check `Doctors.rating` in web before dropping.
- **Migration risk:** Dropping a column loses data. Pre-check that it is all null or zero: `SELECT count(*) FROM "PayrollPayout" WHERE receipt_doc_url IS NOT NULL; SELECT count(*) FROM "Doctors" WHERE rating <> 0;`. **Decisions needed:** (1) Can one person be both a supplier and a customer? If so, `Profiles.mobile @unique` (:460) has to go, which means relaxing a uniqueness the people screens may rely on. (2) Keep `Profiles.role`? It is unread by auth today, but SEC-01 may want it, so I recommend keeping it.
- **Effort:** S

### DES-21: Naming inconsistencies
- **Fix:** Recommended: don't rename. Accept and document the conventions in a short note at the top of `schema.prisma`: plural legacy model names, `total` versus `total_amount`, and `role` meaning three things. Use consistent names for new models.
- **Why this is the simplest:** Every rename touches stored enum values (`PAKISTHANI`), generated client names, every service, the web and mobile types, and offline mobile outboxes, all for no functional gain. Not worth it at this scale.
- **Migration risk:** If you rename anyway, use `@@map`/`@map` so the DB is untouched, and update all three repos in one release. `PAKISTHANI` is a stored enum value, so renaming it needs `ALTER TYPE ... RENAME VALUE` plus a coordinated client release. **Decision needed:** only whether the cosmetic cost is worth a cross-repo release.
- **Effort:** L

---

## Suggested order of execution

1. **Code-only money and stock correctness (one PR, no migration):** DES-02 (code part), DES-05, SEC-03, DES-13, DES-14, DES-11, DES-08, DES-01, PERF-17, and DES-03 part A.
2. **Small hardening (one PR):** SEC-04, SEC-05, SEC-06, SEC-09, SEC-10, SEC-12, and SEC-07's one-liner.
3. **Migration 1, additive indexes:** PERF-01, -02, -03, -05 and -08, plus the PERF-11 drops. Ship with the code from PERF-02, -04 (deploy web together), -07, -09, -10 and -16.
4. **Migration 2, enable `partialIndexes`, run the pre-check queries, clean duplicates:** DES-02 index, PERF-06, then DES-09 (FK actions).
5. **Migration 3, CHECKs and invariants:** DES-10 (code first, then the CHECK), DES-12, DES-07, DES-20. Run every pre-check query first and repair offenders.
6. **Migration 4, types:** DES-16 (hand-edited `USING` cast), DES-19, DES-04 part 2, DES-18.
7. **Owner decisions, in order:** SEC-01 (unblocks SEC-02, SEC-07, SEC-08), then DES-03 part B, DES-06, DES-15, SEC-11, DES-17, DES-21.
8. **Accepted, revisit with `pg_stat_*` data:** PERF-12, PERF-13, PERF-14, PERF-15, PERF-18.
