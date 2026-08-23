# Warehouse → House Stock Transfer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let stock move from a specific warehouse to a specific house as a first-class "on hand, not yet used" state, instead of jumping straight from purchased-somewhere to consumed-at-a-house.

**Architecture:** A new `StockTransfer` record posts a matched pair of `StockLedger` rows (OUT at the warehouse, IN at the house) inside one transaction, reusing the existing `toBaseQuantity`/`StockLedgerService` machinery. `StockLedger.location_type`/`location_id` — defined in the schema today but written by nobody — get populated by every writer (Purchase, Consumption, Adjustment, Transfer) so per-location balances become real. Two new read helpers (`getLocationStock`, `getItemLocationBalance`) compute those balances from `StockLedger`, the same `groupBy` shape the existing item-wide `getItemBalances` already uses.

**Tech Stack:** Bun + Hono + Prisma/PostgreSQL (`server/`), React 19 + Vite + react-hook-form + Zod + TanStack Query (`web/`). Two separate git repos, each on its own `feat/warehouse-house-stock-transfer` branch, merged to `main` at the end of its half.

**Spec:** `server/docs/superpowers/specs/2026-08-23-warehouse-house-stock-transfer-design.md`

## Global Constraints

- `Purchase.warehouse_id` is **nullable in the schema** (one real pre-existing `Purchase` row has a payment against it and is not touched) but **required by the Zod validator** for every new write.
- No backfill of historical `StockLedger.location_type`/`location_id`. Untagged rows never count toward any location's balance.
- No `GET /stock-transfers` list endpoint and no warehouse detail page — out of scope per the spec.
- The coded `StockUnit` draw/relocate path is untouched by this feature.
- This repo's dev server runs via `bun --hot index.ts`, which hot-reloads `.ts` changes but does **not** pick up a regenerated Prisma client. After any `prisma generate`, the running server process must be killed and relaunched (`pkill -f "bun --hot index.ts"`, then `set -a && source .env && set +a && nohup bun --hot index.ts > /tmp/fms-server.log 2>&1 & disown`) before any live/curl/Playwright check against it.
- Never use `prisma migrate dev` in this repo — it triggers a destructive shadow-DB reset prompt on this database's migration history. Always hand-write `migration.sql` and apply with `prisma migrate deploy`.
- Every new backend money/quantity value uses `Prisma.Decimal`, never a native JS number, matching every existing service.

---

## Part A — Backend (`server/` repo)

### Task 1: Schema migration — `Purchase.warehouse_id`, `RefType.TRANSFER`, `StockTransfer`

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/<UTC-timestamp>_warehouse_house_stock_transfer/migration.sql`

**Interfaces:**
- Produces: `Purchase.warehouse_id` (nullable `String`), `RefType.TRANSFER`, the `StockTransfer` model with fields `id, item_id, from_warehouse_id, to_house_id, quantity, unit, base_quantity, note, recorded_by_id, created_at, idempotency_key` — every later task in this plan reads or writes these exact names.

- [ ] **Step 1: Edit `prisma/schema.prisma` — add `warehouse_id` to `Purchase`**

Find the `Purchase` model (starts `model Purchase {`). Add two lines right after the `supplier`/`supplier_id` pair:

```prisma
model Purchase {
  id              String        @id @default(uuid())
  supplier_id     String?
  supplier        Suppliers?    @relation(fields: [supplier_id], references: [id])
  warehouse_id    String?
  warehouse       Warehouses?   @relation(fields: [warehouse_id], references: [id])
  invoice_no      String?
  purchase_date   DateTime
  // Global discount, applied to the sum of the (already net-of-their-own-discount) line totals.
  // Null discount_value = no global discount. total_amount is always the net figure -- everything
  // that reads it (due_amount, Payment reconciliation, Analytics) needs no discount-awareness of its own.
  discount_type   DiscountType?
  discount_value  Decimal?      @db.Decimal(10, 2)
  total_amount    Decimal       @db.Decimal(10, 2)
  paid_amount     Decimal       @db.Decimal(10, 2)
  due_amount      Decimal       @db.Decimal(10, 2)
  recorded_by_id  String
  recorded_by     Profiles      @relation(fields: [recorded_by_id], references: [id])
  created_at      DateTime      @default(now())

  items PurchaseItem[]

  @@index([supplier_id, purchase_date])
}
```

(Only the `warehouse_id`/`warehouse` lines are new — everything else in that block is unchanged, shown for exact placement.)

- [ ] **Step 2: Edit `prisma/schema.prisma` — add `TRANSFER` to `RefType`**

Find `enum RefType { PURCHASE CONSUMPTION ADJUSTMENT }` and change to:

```prisma
enum RefType {
  PURCHASE
  CONSUMPTION
  ADJUSTMENT
  TRANSFER
}
```

- [ ] **Step 3: Edit `prisma/schema.prisma` — add the `StockTransfer` model**

Add this new model anywhere after the `Item`, `Warehouses`, `Houses`, `Unit`, and `Profiles` models are defined (e.g. right after `InventoryAdjustment`):

```prisma
model StockTransfer {
  id                String     @id @default(uuid())
  item_id           String
  item              Item       @relation(fields: [item_id], references: [id])
  from_warehouse_id String
  from_warehouse    Warehouses @relation(fields: [from_warehouse_id], references: [id])
  to_house_id       String
  to_house          Houses     @relation(fields: [to_house_id], references: [id])
  quantity          Decimal    @db.Decimal(10, 3) // as entered, in `unit`
  unit              String
  unitRef           Unit       @relation(fields: [unit], references: [code], onUpdate: Cascade)
  base_quantity     Decimal    @db.Decimal(10, 3) // quantity converted to Item.unit, snapshotted at write time
  note              String?
  recorded_by_id    String
  recorded_by       Profiles   @relation(fields: [recorded_by_id], references: [id])
  created_at        DateTime   @default(now())
  idempotency_key   String     @unique

  @@index([item_id])
  @@index([to_house_id])
}
```

- [ ] **Step 4: Edit `prisma/schema.prisma` — add the five back-relations**

Add one line to each of these five existing models (find each, add the shown line inside its relations block):

In `model Item { ... }`, alongside `inventoryAdjustments InventoryAdjustment[]`:
```prisma
  stockTransfers       StockTransfer[]
```

In `model Warehouses { ... }` (currently just `inventoryAdjustments InventoryAdjustment[]`), add two lines:
```prisma
  purchases            Purchase[]
  stockTransfers       StockTransfer[]
```

In `model Houses { ... }`, alongside `inventoryAdjustments InventoryAdjustment[]`:
```prisma
  stockTransfers       StockTransfer[]
```

In `model Profiles { ... }`, alongside `purchasesRecorded Purchase[]` and `inventoryAdjustments InventoryAdjustment[]`:
```prisma
  stockTransfersRecorded StockTransfer[]
```

In `model Unit { ... }`, alongside `consumptions Consumption[]`:
```prisma
  stockTransfers       StockTransfer[]
```

- [ ] **Step 5: Validate the schema**

Run: `cd server && bunx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 6: Hand-write the migration**

Get a UTC timestamp and create the migration folder:

```bash
cd server
TS=$(date -u +"%Y%m%d%H%M%S")
mkdir -p "prisma/migrations/${TS}_warehouse_house_stock_transfer"
echo "$TS"
```

Write `prisma/migrations/<TS>_warehouse_house_stock_transfer/migration.sql` (replace `<TS>` in the path with the timestamp printed above):

```sql
-- AlterTable: Purchase gains an optional warehouse. Nullable -- there is one real
-- pre-existing Purchase row (with a payment against it) that is not backfilled.
ALTER TABLE "Purchase" ADD COLUMN "warehouse_id" TEXT;
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "Warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterEnum: RefType gains TRANSFER
ALTER TYPE "RefType" ADD VALUE 'TRANSFER';

-- CreateTable: StockTransfer
CREATE TABLE "StockTransfer" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "from_warehouse_id" TEXT NOT NULL,
    "to_house_id" TEXT NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "base_quantity" DECIMAL(10,3) NOT NULL,
    "note" TEXT,
    "recorded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotency_key" TEXT NOT NULL,

    CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StockTransfer_idempotency_key_key" ON "StockTransfer"("idempotency_key");
CREATE INDEX "StockTransfer_item_id_idx" ON "StockTransfer"("item_id");
CREATE INDEX "StockTransfer_to_house_id_idx" ON "StockTransfer"("to_house_id");

ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_from_warehouse_id_fkey" FOREIGN KEY ("from_warehouse_id") REFERENCES "Warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_to_house_id_fkey" FOREIGN KEY ("to_house_id") REFERENCES "Houses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_unit_fkey" FOREIGN KEY ("unit") REFERENCES "Unit"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "Profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 7: Apply the migration and regenerate the client**

```bash
cd server
bunx prisma migrate deploy
bunx prisma generate
```
Expected: `All migrations have been successfully applied.` then `✔ Generated Prisma Client`.

- [ ] **Step 8: Full regression check**

```bash
cd server
bunx tsc --noEmit
bun test
```
Expected: no tsc errors; all existing tests still pass (this step only changed schema shape, no service logic yet, so nothing should behave differently — a failure here means Step 1-4 broke an existing relation name).

- [ ] **Step 9: Create the branch and commit**

```bash
cd server
git checkout -b feat/warehouse-house-stock-transfer
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add Purchase.warehouse_id, RefType.TRANSFER, StockTransfer model"
```

---

### Task 2: Location-aware balance helpers + `StockLedgerService` location fields

**Files:**
- Modify: `server/src/services/stock-ledger.service.ts`
- Modify: `server/src/lib/stock-balance.ts`
- Modify: `server/src/lib/stock-balance.test.ts`

**Interfaces:**
- Consumes: nothing new (uses the `StockLedger` shape from Task 1's migration).
- Produces: `LedgerEntryInput` gains optional `location_type?: "WAREHOUSE" | "HOUSE" | "DISPOSAL"`, `location_id?: string`, and `ref_type` gains `"TRANSFER"` — Tasks 3, 4, 5, 6 all pass these. `getLocationStock(location_type, location_id): Promise<{item_id: string; balance: Prisma.Decimal}[]>` — Task 7 calls this. `getItemLocationBalance(tx, item_id, location_type, location_id): Promise<Prisma.Decimal>` — Tasks 4 and 6 call this inside their own transactions.

- [ ] **Step 1: Write the failing tests**

Open `server/src/lib/stock-balance.test.ts`. It currently has one `describe("getItemBalances", ...)` block — leave that alone. Add these two new imports at the top (alongside the existing `getItemBalances` import) and one new `describe` block at the end of the file:

```ts
import { getItemBalances, getLocationStock, getItemLocationBalance } from "./stock-balance";
```

```ts
describe("getLocationStock and getItemLocationBalance", () => {
    const createdItemIds: string[] = [];

    afterAll(async () => {
        await prisma.stockLedger.deleteMany({ where: { item_id: { in: createdItemIds } } });
        await prisma.item.deleteMany({ where: { id: { in: createdItemIds } } });
    });

    test("getLocationStock sums IN minus OUT per item at a specific location, ignoring other locations and untagged rows", async () => {
        const item = await prisma.item.create({
            data: {
                name: `Location Stock Test ${crypto.randomUUID()}`,
                normalized_key: `location stock test ${crypto.randomUUID()}`,
                category: "FEED",
                unit: "G",
            },
        });
        createdItemIds.push(item.id);
        const houseId = crypto.randomUUID();
        const otherHouseId = crypto.randomUUID();

        await prisma.stockLedger.createMany({
            data: [
                {
                    item_id: item.id, quantity: 100, direction: "IN", reason: "TRANSFER",
                    ref_type: "TRANSFER", ref_id: crypto.randomUUID(), idempotency_key: crypto.randomUUID(),
                    location_type: "HOUSE", location_id: houseId,
                },
                {
                    item_id: item.id, quantity: 30, direction: "OUT", reason: "CONSUMPTION",
                    ref_type: "CONSUMPTION", ref_id: crypto.randomUUID(), idempotency_key: crypto.randomUUID(),
                    location_type: "HOUSE", location_id: houseId,
                },
                {
                    item_id: item.id, quantity: 500, direction: "IN", reason: "TRANSFER",
                    ref_type: "TRANSFER", ref_id: crypto.randomUUID(), idempotency_key: crypto.randomUUID(),
                    location_type: "HOUSE", location_id: otherHouseId,
                },
                {
                    item_id: item.id, quantity: 1000, direction: "IN", reason: "PURCHASE",
                    ref_type: "PURCHASE", ref_id: crypto.randomUUID(), idempotency_key: crypto.randomUUID(),
                },
            ],
        });

        const stock = await getLocationStock("HOUSE", houseId);
        const row = stock.find((s) => s.item_id === item.id);
        expect(row?.balance.toNumber()).toBe(70);
    });

    test("getItemLocationBalance returns the same net figure for one item at one location, inside a transaction", async () => {
        const item = await prisma.item.create({
            data: {
                name: `Item Location Balance Test ${crypto.randomUUID()}`,
                normalized_key: `item location balance test ${crypto.randomUUID()}`,
                category: "FEED",
                unit: "G",
            },
        });
        createdItemIds.push(item.id);
        const warehouseId = crypto.randomUUID();

        await prisma.stockLedger.create({
            data: {
                item_id: item.id, quantity: 250, direction: "IN", reason: "PURCHASE",
                ref_type: "PURCHASE", ref_id: crypto.randomUUID(), idempotency_key: crypto.randomUUID(),
                location_type: "WAREHOUSE", location_id: warehouseId,
            },
        });

        const balance = await prisma.$transaction((tx) =>
            getItemLocationBalance(tx, item.id, "WAREHOUSE", warehouseId),
        );
        expect(balance.toNumber()).toBe(250);
    });

    test("getItemLocationBalance returns zero for a location with no activity", async () => {
        const item = await prisma.item.create({
            data: {
                name: `No Activity Test ${crypto.randomUUID()}`,
                normalized_key: `no activity test ${crypto.randomUUID()}`,
                category: "FEED",
                unit: "G",
            },
        });
        createdItemIds.push(item.id);

        const balance = await prisma.$transaction((tx) =>
            getItemLocationBalance(tx, item.id, "WAREHOUSE", crypto.randomUUID()),
        );
        expect(balance.toNumber()).toBe(0);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && bun test src/lib/stock-balance.test.ts`
Expected: FAIL — `getLocationStock`/`getItemLocationBalance` are not exported from `./stock-balance`.

- [ ] **Step 3: Add the `location_type`/`location_id` fields to `LedgerEntryInput`**

In `server/src/services/stock-ledger.service.ts`, change:

```ts
type LedgerEntryInput = {
    item_id: string;
    quantity: Prisma.Decimal | number;
    direction: "IN" | "OUT";
    reason:
        | "PURCHASE"
        | "TRANSFER"
        | "CONSUMPTION"
        | "WASTAGE"
        | "EXPIRED"
        | "ADJUSTMENT"
        | "OPENING_BALANCE";
    ref_type: "PURCHASE" | "CONSUMPTION" | "ADJUSTMENT" | "TRANSFER";
    ref_id: string;
    unit_cost?: Prisma.Decimal | number;
    location_type?: "WAREHOUSE" | "HOUSE" | "DISPOSAL";
    location_id?: string;
    idempotency_key?: string;
};
```

(The only changes from the current file are `ref_type` gaining `"TRANSFER"`, and the two new optional `location_*` fields — everything else is unchanged.)

- [ ] **Step 4: Implement `getLocationStock` and `getItemLocationBalance`**

In `server/src/lib/stock-balance.ts`, add these two functions after the existing `getItemBalances`:

```ts
/** Current balance per item at one location, e.g. "what's on hand at House 3 right now" --
 * only entries tagged with this exact location_type+location_id count. Untagged StockLedger
 * rows (most historical data, predating this feature) are never counted toward any location. */
export async function getLocationStock(
    location_type: "WAREHOUSE" | "HOUSE",
    location_id: string,
): Promise<{ item_id: string; balance: Prisma.Decimal }[]> {
    const sums = await prisma.stockLedger.groupBy({
        by: ["item_id", "direction"],
        where: { location_type, location_id },
        _sum: { quantity: true },
    });

    const balances = new Map<string, Prisma.Decimal>();
    for (const row of sums) {
        const quantity = row._sum.quantity ?? new Prisma.Decimal(0);
        const current = balances.get(row.item_id) ?? new Prisma.Decimal(0);
        balances.set(row.item_id, row.direction === "IN" ? current.plus(quantity) : current.minus(quantity));
    }
    return Array.from(balances.entries()).map(([item_id, balance]) => ({ item_id, balance }));
}

/** Same balance as getLocationStock, for one item at one location, inside an in-flight
 * transaction -- for a write that needs to validate against the current balance before
 * posting (Transfer checking warehouse stock, Consumption checking house stock) without a
 * race between the check and the write. */
export async function getItemLocationBalance(
    tx: Prisma.TransactionClient,
    item_id: string,
    location_type: "WAREHOUSE" | "HOUSE",
    location_id: string,
): Promise<Prisma.Decimal> {
    const sums = await tx.stockLedger.groupBy({
        by: ["direction"],
        where: { item_id, location_type, location_id },
        _sum: { quantity: true },
    });
    let balance = new Prisma.Decimal(0);
    for (const row of sums) {
        const quantity = row._sum.quantity ?? new Prisma.Decimal(0);
        balance = row.direction === "IN" ? balance.plus(quantity) : balance.minus(quantity);
    }
    return balance;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && bun test src/lib/stock-balance.test.ts`
Expected: PASS, all tests including the 3 pre-existing `getItemBalances` ones.

- [ ] **Step 6: Typecheck and full regression**

```bash
cd server
bunx tsc --noEmit
bun test
```
Expected: no errors, all tests pass.

- [ ] **Step 7: Commit**

```bash
cd server
git add src/services/stock-ledger.service.ts src/lib/stock-balance.ts src/lib/stock-balance.test.ts
git commit -m "feat: add location-aware stock balance helpers"
```

---

### Task 3: Purchase — require `warehouse_id`, tag its `StockLedger` entry

**Files:**
- Modify: `server/src/validators/purchase.validator.ts`
- Modify: `server/src/services/purchase.service.ts`
- Modify: `server/src/services/purchase.service.test.ts`

**Interfaces:**
- Consumes: `LedgerEntryInput.location_type`/`location_id` from Task 2.
- Produces: `CreatePurchaseInput` gains required `warehouse_id: string` — no other task depends on this beyond the frontend purchase form (Task 10).

- [ ] **Step 1: Write the failing tests**

Add this import to `server/src/services/purchase.service.test.ts`, alongside the existing ones:

```ts
import { createPurchaseSchema } from "@validators/purchase.validator";
```

Then add these two tests inside the existing `describe("PurchaseService", ...)` block (both are self-contained — the second creates its own item and warehouse — so they can go anywhere inside that block; add them near the end). The first checks the validator directly (there's no way to call `PurchaseService.create` without `warehouse_id` and still compile, once it's a required field in `CreatePurchaseInput` — this is TypeScript's job, so the validator itself is what needs the runtime check):

```ts
    test("createPurchaseSchema rejects a payload with no warehouse_id", () => {
        const result = createPurchaseSchema.safeParse({
            purchase_date: new Date().toISOString(),
            recorded_by_id: crypto.randomUUID(),
            items: [{ item_id: crypto.randomUUID(), quantity: 1, unit: "G", unit_price: 1 }],
        });
        expect(result.success).toBe(false);
    });

    test("create tags the StockLedger entry with the purchase's warehouse", async () => {
        const item = await prisma.item.create({
            data: {
                name: `Warehouse Tag Test ${crypto.randomUUID()}`,
                normalized_key: `warehouse tag test ${crypto.randomUUID()}`,
                category: "FEED",
                unit: "G",
            },
        });
        const warehouse = await prisma.warehouses.create({
            data: { name: `Test Warehouse ${crypto.randomUUID()}` },
        });

        const purchase = await PurchaseService.create({
            warehouse_id: warehouse.id,
            purchase_date: new Date(),
            recorded_by_id: profileId,
            paid_amount: 0,
            items: [{ item_id: item.id, quantity: 10, unit: "G", unit_price: 5 }],
        });

        const entry = await prisma.stockLedger.findFirst({
            where: { ref_type: "PURCHASE", ref_id: purchase!.items[0]!.id },
        });
        expect(entry?.location_type).toBe("WAREHOUSE");
        expect(entry?.location_id).toBe(warehouse.id);

        await prisma.stockLedger.deleteMany({ where: { item_id: item.id } });
        await prisma.purchaseItem.deleteMany({ where: { item_id: item.id } });
        await prisma.purchase.delete({ where: { id: purchase!.id } });
        await prisma.warehouses.delete({ where: { id: warehouse.id } });
        await prisma.item.delete({ where: { id: item.id } });
    });
```

This test uses `profileId`, which the file already declares (module-level `let profileId: string;`, set in the top `beforeAll`) — reuse it, don't redeclare it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && bun test src/services/purchase.service.test.ts`
Expected: `bun test` doesn't type-check (it transpiles and runs), so both new tests execute but FAIL on their assertions: "createPurchaseSchema rejects" fails because `warehouse_id` isn't required yet (the parse currently succeeds); "tags the StockLedger entry" fails because the ledger entry's `location_type` is `null`.

- [ ] **Step 3: Require `warehouse_id` in the validator**

In `server/src/validators/purchase.validator.ts`, change `createPurchaseSchema`'s object literal to add one field (everything else unchanged):

```ts
export const createPurchaseSchema = z
    .object({
        supplier_id: z.string().uuid().optional(),
        warehouse_id: z.string().uuid(),
        invoice_no: z.string().optional(),
        purchase_date: z.coerce.date(),
        paid_amount: z.coerce.number().nonnegative().default(0),
        recorded_by_id: z.string().uuid(),
        ...discountFields,
        items: z.array(purchaseItemInput).min(1, "At least one item is required"),
    })
    .refine(discountRefine, discountRefineMessage);
```

- [ ] **Step 4: Wire `warehouse_id` into `purchase.service.ts`**

In `server/src/services/purchase.service.ts`, inside `PurchaseService.create`, the `tx.purchase.create({...})` call currently has this shape:

```ts
                const purchase = await tx.purchase.create({
                    data: {
                        purchase_date: data.purchase_date,
                        total_amount,
                        paid_amount,
                        due_amount,
                        recorded_by_id: data.recorded_by_id,
                        ...(data.supplier_id !== undefined && { supplier_id: data.supplier_id }),
                        ...(data.invoice_no !== undefined && { invoice_no: data.invoice_no }),
                        ...(data.discount_type !== undefined &&
                            data.discount_value !== undefined && {
                                discount_type: data.discount_type,
                                discount_value: data.discount_value,
                            }),
                    },
                });
```

Add `warehouse_id: data.warehouse_id,` as an unconditional field (it's required now, unlike `supplier_id`):

```ts
                const purchase = await tx.purchase.create({
                    data: {
                        purchase_date: data.purchase_date,
                        warehouse_id: data.warehouse_id,
                        total_amount,
                        paid_amount,
                        due_amount,
                        recorded_by_id: data.recorded_by_id,
                        ...(data.supplier_id !== undefined && { supplier_id: data.supplier_id }),
                        ...(data.invoice_no !== undefined && { invoice_no: data.invoice_no }),
                        ...(data.discount_type !== undefined &&
                            data.discount_value !== undefined && {
                                discount_type: data.discount_type,
                                discount_value: data.discount_value,
                            }),
                    },
                });
```

Then, the `StockLedgerService.record(tx, {...})` call inside the `for (const item of itemsWithTotals)` loop currently ends with `unit_cost: item.total_price.dividedBy(base_quantity),`. Add two more fields after it:

```ts
                    await StockLedgerService.record(tx, {
                        item_id: item.item_id,
                        quantity: base_quantity,
                        direction: "IN",
                        reason: "PURCHASE",
                        ref_type: "PURCHASE",
                        ref_id: purchaseItem.id,
                        // Net line cost per base unit, not the raw unit_price -- base_quantity
                        // is in the item's base unit while unit_price is per purchase unit, and
                        // total_price is already net of the line's own discount.
                        unit_cost: item.total_price.dividedBy(base_quantity),
                        location_type: "WAREHOUSE",
                        location_id: data.warehouse_id,
                    });
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd server && bun test src/services/purchase.service.test.ts`
Expected: PASS, all tests in the file (adding `warehouse_id` as required will break every OTHER existing test in this file that calls `PurchaseService.create` without it — fix each by adding a `warehouse_id` field. Create one shared warehouse in the file's top-level `beforeAll` alongside the existing item/profile/supplier setup, store its id in a new module-level `let warehouseId: string;`, and pass `warehouse_id: warehouseId` in every `PurchaseService.create(...)` call in this file that's currently missing it. Clean it up in the file's `afterAll` with `await prisma.warehouses.delete({ where: { id: warehouseId } });`).

- [ ] **Step 6: Typecheck and full regression**

```bash
cd server
bunx tsc --noEmit
bun test
```
Expected: no errors. `analytics.service.test.ts` and `consumption.service.test.ts` also call `PurchaseService.create` or `prisma.purchase.create` directly — direct `prisma.purchase.create` calls are unaffected (schema field is nullable), but any call through `PurchaseService.create` needs the same `warehouse_id` fix as Step 5. Grep first: `grep -rn "PurchaseService.create" src/ --include="*.test.ts"` and fix every match the same way.

- [ ] **Step 7: Commit**

```bash
cd server
git add src/validators/purchase.validator.ts src/services/purchase.service.ts src/services/purchase.service.test.ts
git commit -m "feat: require Purchase.warehouse_id, tag its StockLedger entry"
```

(If other test files needed the same fix in Step 6, add them to this commit too.)

---

### Task 4: Consumption — house-balance validation (aggregate path) + location tagging

**Files:**
- Modify: `server/src/services/consumption.service.ts`
- Modify: `server/src/services/consumption.service.test.ts`

**Interfaces:**
- Consumes: `getItemLocationBalance` from Task 2.
- Produces: nothing new consumed by later tasks — this is a leaf change.

- [ ] **Step 1: Write the failing tests**

Add this new `describe` block at the end of `server/src/services/consumption.service.test.ts` (self-contained — do not touch the existing `describe("ConsumptionService", ...)` block):

```ts
describe("ConsumptionService aggregate house-balance validation", () => {
    const createdItemIds: string[] = [];
    const createdHouseIds: string[] = [];
    const createdConsumptionIds: string[] = [];
    let profileId: string;

    beforeAll(async () => {
        const profile = await prisma.profiles.create({
            data: {
                name: "House Balance Tester",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "ADMIN",
            },
        });
        profileId = profile.id;
    });

    afterAll(async () => {
        await prisma.consumption.deleteMany({ where: { id: { in: createdConsumptionIds } } });
        await prisma.stockLedger.deleteMany({ where: { item_id: { in: createdItemIds } } });
        await prisma.item.deleteMany({ where: { id: { in: createdItemIds } } });
        await prisma.houses.deleteMany({ where: { id: { in: createdHouseIds } } });
        await prisma.profiles.delete({ where: { id: profileId } });
    });

    test("rejects an aggregate draw that exceeds the item's balance at that house", async () => {
        const item = await prisma.item.create({
            data: {
                name: `House Balance Item ${crypto.randomUUID()}`,
                normalized_key: `house balance item ${crypto.randomUUID()}`,
                category: "FEED",
                unit: "G",
            },
        });
        createdItemIds.push(item.id);
        const house = await prisma.houses.create({
            data: { name: "House Balance Test House", type: "GROWER", number: Math.floor(Math.random() * 100000) },
        });
        createdHouseIds.push(house.id);

        await expect(
            ConsumptionService.create({
                house_id: house.id,
                item_id: item.id,
                quantity: 10,
                unit: "G",
                date: new Date(),
                recorded_by_id: profileId,
            }),
        ).rejects.toMatchObject({ status: 409 });
    });

    test("allows an aggregate draw within the item's balance at that house, and tags the OUT entry HOUSE", async () => {
        const item = await prisma.item.create({
            data: {
                name: `House Balance Item Ok ${crypto.randomUUID()}`,
                normalized_key: `house balance item ok ${crypto.randomUUID()}`,
                category: "FEED",
                unit: "G",
            },
        });
        createdItemIds.push(item.id);
        const house = await prisma.houses.create({
            data: { name: "House Balance Ok Test House", type: "GROWER", number: Math.floor(Math.random() * 100000) },
        });
        createdHouseIds.push(house.id);

        // Simulate a prior transfer having landed 50 G at this house.
        await prisma.stockLedger.create({
            data: {
                item_id: item.id, quantity: 50, direction: "IN", reason: "TRANSFER",
                ref_type: "TRANSFER", ref_id: crypto.randomUUID(), idempotency_key: crypto.randomUUID(),
                location_type: "HOUSE", location_id: house.id,
            },
        });

        const consumption = await ConsumptionService.create({
            house_id: house.id,
            item_id: item.id,
            quantity: 20,
            unit: "G",
            date: new Date(),
            recorded_by_id: profileId,
        });
        createdConsumptionIds.push(consumption!.id);

        const ledgerEntry = await prisma.stockLedger.findFirst({
            where: { ref_type: "CONSUMPTION", ref_id: consumption!.id },
        });
        expect(ledgerEntry?.location_type).toBe("HOUSE");
        expect(ledgerEntry?.location_id).toBe(house.id);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && bun test src/services/consumption.service.test.ts -t "house-balance"`
Expected: FAIL — the "rejects" test currently succeeds (no house-balance check exists yet), and `location_type` on the ledger entry is `null`.

- [ ] **Step 3: Add the house-balance check and location tagging**

In `server/src/services/consumption.service.ts`, add this import alongside the existing ones:

```ts
import { getItemLocationBalance } from "@lib/stock-balance";
```

Then, inside `ConsumptionService.create`'s transaction, the current shape is:

```ts
                if (data.stock_unit_id !== undefined) {
                    const unitId = data.stock_unit_id;
                    const unit = await tx.stockUnit.findUnique({ where: { id: unitId } });
                    if (!unit) throw AppError.notFound("StockUnit");
                    if (unit.status !== "IN_STOCK" && unit.status !== "IN_USE") {
                        throw AppError.conflict(
                            `StockUnit is ${unit.status.toLowerCase()}, cannot draw from it`,
                        );
                    }

                    if (unit.remaining_quantity !== null) {
                        if (unit.remaining_quantity.lessThan(base_quantity)) {
                            throw AppError.conflict(
                                "Consumption quantity exceeds remaining stock in this unit",
                            );
                        }
                        const remaining = unit.remaining_quantity.minus(base_quantity);
                        await tx.stockUnit.update({
                            where: { id: unitId },
                            data: {
                                remaining_quantity: remaining,
                                status: remaining.isZero() ? "CONSUMED" : "IN_USE",
                            },
                        });
                    } else if (unit.status === "IN_STOCK") {
                        await tx.stockUnit.update({
                            where: { id: unitId },
                            data: { status: "IN_USE" },
                        });
                    }
                }
```

Add an `else` branch after this `if` block, with the house-balance check:

```ts
                if (data.stock_unit_id !== undefined) {
                    const unitId = data.stock_unit_id;
                    const unit = await tx.stockUnit.findUnique({ where: { id: unitId } });
                    if (!unit) throw AppError.notFound("StockUnit");
                    if (unit.status !== "IN_STOCK" && unit.status !== "IN_USE") {
                        throw AppError.conflict(
                            `StockUnit is ${unit.status.toLowerCase()}, cannot draw from it`,
                        );
                    }

                    if (unit.remaining_quantity !== null) {
                        if (unit.remaining_quantity.lessThan(base_quantity)) {
                            throw AppError.conflict(
                                "Consumption quantity exceeds remaining stock in this unit",
                            );
                        }
                        const remaining = unit.remaining_quantity.minus(base_quantity);
                        await tx.stockUnit.update({
                            where: { id: unitId },
                            data: {
                                remaining_quantity: remaining,
                                status: remaining.isZero() ? "CONSUMED" : "IN_USE",
                            },
                        });
                    } else if (unit.status === "IN_STOCK") {
                        await tx.stockUnit.update({
                            where: { id: unitId },
                            data: { status: "IN_USE" },
                        });
                    }
                } else {
                    // Aggregate (non-coded) draw -- must not exceed what's actually been
                    // transferred to this house and not yet used.
                    const available = await getItemLocationBalance(tx, data.item_id, "HOUSE", data.house_id);
                    if (available.lessThan(base_quantity)) {
                        throw AppError.conflict(
                            `Only ${available.toString()} of this item is on hand at this house`,
                        );
                    }
                }
```

Then the `StockLedgerService.record(tx, {...})` call right after (currently ending at `ref_id: consumption.id,`) gets two more fields:

```ts
                await StockLedgerService.record(tx, {
                    item_id: data.item_id,
                    quantity: base_quantity,
                    direction: "OUT",
                    reason: "CONSUMPTION",
                    ref_type: "CONSUMPTION",
                    ref_id: consumption.id,
                    location_type: "HOUSE",
                    location_id: data.house_id,
                });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && bun test src/services/consumption.service.test.ts`
Expected: PASS for the two new tests. The pre-existing aggregate-draw tests in this file (e.g. "aggregate draw (no stock_unit_id) writes a StockLedger OUT entry") will now FAIL if they draw more than that item's house-balance allows, since they predate any location-tagged stock existing at that house — **this is expected**; fix each by posting a `TRANSFER`-reason `StockLedger` IN row at that test's `houseId`/item for at least the consumed quantity before calling `ConsumptionService.create`, using the exact same shape as the "allows an aggregate draw" test above.

- [ ] **Step 5: Typecheck and full regression**

```bash
cd server
bunx tsc --noEmit
bun test
```
Expected: no errors, all tests pass (including any other test files with aggregate consumption calls, e.g. `analytics.service.test.ts` if it calls `ConsumptionService.create` directly for a non-coded draw — grep first: `grep -rln "ConsumptionService.create" src/ --include="*.test.ts"`, check each call for whether it omits `stock_unit_id`, and pre-seed house balance the same way if so).

- [ ] **Step 6: Commit**

```bash
cd server
git add src/services/consumption.service.ts src/services/consumption.service.test.ts
git commit -m "feat: enforce house-balance on aggregate Consumption, tag its StockLedger entry"
```

(Add any other test files touched in Step 5 to this commit too.)

---

### Task 5: InventoryAdjustment — location tagging

**Files:**
- Modify: `server/src/services/inventory-adjustment.service.ts`
- Modify: `server/src/services/inventory-adjustment.service.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new consumed by later tasks — leaf change.

- [ ] **Step 1: Write the failing test**

Add this test to `server/src/services/inventory-adjustment.service.test.ts` (inside its existing `describe` block, or as a standalone `test(...)` if the file has no wrapping `describe` — check the file first):

```ts
test("create tags the StockLedger entry with whichever location was given", async () => {
    const item = await prisma.item.create({
        data: {
            name: `Adjustment Location Test ${crypto.randomUUID()}`,
            normalized_key: `adjustment location test ${crypto.randomUUID()}`,
            category: "FEED",
            unit: "G",
        },
    });
    const warehouse = await prisma.warehouses.create({
        data: { name: `Adj Test Warehouse ${crypto.randomUUID()}` },
    });
    const profile = await prisma.profiles.create({
        data: {
            name: "Adjustment Location Tester",
            mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
            role: "ADMIN",
        },
    });

    const adjustment = await InventoryAdjustmentService.create({
        item_id: item.id,
        warehouse_id: warehouse.id,
        quantity_before: 0,
        quantity_after: 40,
        reason: "Test",
        recorded_by_id: profile.id,
    });

    const entry = await prisma.stockLedger.findFirst({
        where: { ref_type: "ADJUSTMENT", ref_id: adjustment!.id },
    });
    expect(entry?.location_type).toBe("WAREHOUSE");
    expect(entry?.location_id).toBe(warehouse.id);

    await prisma.stockLedger.deleteMany({ where: { item_id: item.id } });
    await prisma.inventoryAdjustment.delete({ where: { id: adjustment!.id } });
    await prisma.warehouses.delete({ where: { id: warehouse.id } });
    await prisma.profiles.delete({ where: { id: profile.id } });
    await prisma.item.delete({ where: { id: item.id } });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && bun test src/services/inventory-adjustment.service.test.ts -t "whichever location"`
Expected: FAIL — `location_type` is `null`.

- [ ] **Step 3: Wire location tagging into `inventory-adjustment.service.ts`**

The `StockLedgerService.record(tx, {...})` call currently reads:

```ts
                await StockLedgerService.record(tx, {
                    item_id: data.item_id,
                    quantity: delta.abs(),
                    direction: delta.isPositive() ? "IN" : "OUT",
                    reason: "ADJUSTMENT",
                    ref_type: "ADJUSTMENT",
                    ref_id: adjustment.id,
                });
```

Change to:

```ts
                await StockLedgerService.record(tx, {
                    item_id: data.item_id,
                    quantity: delta.abs(),
                    direction: delta.isPositive() ? "IN" : "OUT",
                    reason: "ADJUSTMENT",
                    ref_type: "ADJUSTMENT",
                    ref_id: adjustment.id,
                    // house_id wins if the caller somehow set both -- the validator only
                    // requires at least one, not exactly one.
                    ...(data.warehouse_id !== undefined && {
                        location_type: "WAREHOUSE" as const,
                        location_id: data.warehouse_id,
                    }),
                    ...(data.house_id !== undefined && {
                        location_type: "HOUSE" as const,
                        location_id: data.house_id,
                    }),
                });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && bun test src/services/inventory-adjustment.service.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Typecheck and full regression**

```bash
cd server
bunx tsc --noEmit
bun test
```
Expected: no errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
cd server
git add src/services/inventory-adjustment.service.ts src/services/inventory-adjustment.service.test.ts
git commit -m "feat: tag InventoryAdjustment's StockLedger entry with its location"
```

---

### Task 6: `TransferService` — validator, service, controller, routes

**Files:**
- Create: `server/src/validators/transfer.validator.ts`
- Create: `server/src/services/transfer.service.ts`
- Create: `server/src/services/transfer.service.test.ts`
- Create: `server/src/controllers/transfer.controller.ts`
- Create: `server/src/routes/transfer.routes.ts`
- Modify: `server/src/routes/index.ts`

**Interfaces:**
- Consumes: `toBaseQuantity` (`@lib/unit-conversion`), `getItemLocationBalance` (Task 2), `StockLedgerService.record` (Task 2's widened type).
- Produces: `POST /stock-transfers` — consumed by the frontend (Task 11).

- [ ] **Step 1: Write the validator**

Create `server/src/validators/transfer.validator.ts`:

```ts
import { z } from "zod";
import { unitSchema } from "@lib/enums";

export const createStockTransferSchema = z.object({
    item_id: z.string().uuid(),
    from_warehouse_id: z.string().uuid(),
    to_house_id: z.string().uuid(),
    quantity: z.coerce.number().positive("Quantity must be positive"),
    unit: unitSchema,
    note: z.string().optional(),
    recorded_by_id: z.string().uuid(),
    idempotency_key: z.string().min(1).optional(),
});

export type CreateStockTransferInput = z.infer<typeof createStockTransferSchema>;
```

- [ ] **Step 2: Write the failing service tests**

Create `server/src/services/transfer.service.test.ts`:

```ts
import { describe, test, expect, afterAll } from "bun:test";
import prisma from "@lib/db";
import { TransferService } from "./transfer.service";

describe("TransferService", () => {
    const createdItemIds: string[] = [];
    const createdWarehouseIds: string[] = [];
    const createdHouseIds: string[] = [];
    const createdProfileIds: string[] = [];
    const createdTransferIds: string[] = [];

    afterAll(async () => {
        await prisma.stockTransfer.deleteMany({ where: { id: { in: createdTransferIds } } });
        await prisma.stockLedger.deleteMany({ where: { item_id: { in: createdItemIds } } });
        await prisma.itemUnit.deleteMany({ where: { item_id: { in: createdItemIds } } });
        await prisma.item.deleteMany({ where: { id: { in: createdItemIds } } });
        await prisma.warehouses.deleteMany({ where: { id: { in: createdWarehouseIds } } });
        await prisma.houses.deleteMany({ where: { id: { in: createdHouseIds } } });
        await prisma.profiles.deleteMany({ where: { id: { in: createdProfileIds } } });
    });

    async function makeFixtures() {
        const item = await prisma.item.create({
            data: {
                name: `Transfer Test Item ${crypto.randomUUID()}`,
                normalized_key: `transfer test item ${crypto.randomUUID()}`,
                category: "FEED",
                unit: "G",
            },
        });
        createdItemIds.push(item.id);
        const warehouse = await prisma.warehouses.create({
            data: { name: `Transfer Test Warehouse ${crypto.randomUUID()}` },
        });
        createdWarehouseIds.push(warehouse.id);
        const house = await prisma.houses.create({
            data: { name: "Transfer Test House", type: "GROWER", number: Math.floor(Math.random() * 100000) },
        });
        createdHouseIds.push(house.id);
        const profile = await prisma.profiles.create({
            data: {
                name: "Transfer Tester",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "ADMIN",
            },
        });
        createdProfileIds.push(profile.id);
        return { item, warehouse, house, profile };
    }

    test("posts a WAREHOUSE OUT and a HOUSE IN entry, both tagged TRANSFER, sharing one ref_id", async () => {
        const { item, warehouse, house, profile } = await makeFixtures();
        await prisma.stockLedger.create({
            data: {
                item_id: item.id, quantity: 100, direction: "IN", reason: "PURCHASE",
                ref_type: "PURCHASE", ref_id: crypto.randomUUID(), idempotency_key: crypto.randomUUID(),
                location_type: "WAREHOUSE", location_id: warehouse.id,
            },
        });

        const transfer = await TransferService.create({
            item_id: item.id,
            from_warehouse_id: warehouse.id,
            to_house_id: house.id,
            quantity: 40,
            unit: "G",
            recorded_by_id: profile.id,
        });
        createdTransferIds.push(transfer!.id);

        const entries = await prisma.stockLedger.findMany({
            where: { ref_type: "TRANSFER", ref_id: transfer!.id },
        });
        expect(entries).toHaveLength(2);
        const out = entries.find((e) => e.direction === "OUT");
        const inn = entries.find((e) => e.direction === "IN");
        expect(out?.location_type).toBe("WAREHOUSE");
        expect(out?.location_id).toBe(warehouse.id);
        expect(inn?.location_type).toBe("HOUSE");
        expect(inn?.location_id).toBe(house.id);
        expect(out?.quantity.toNumber()).toBe(40);
        expect(inn?.quantity.toNumber()).toBe(40);
    });

    test("rejects a quantity exceeding the item's balance at the source warehouse", async () => {
        const { item, warehouse, house, profile } = await makeFixtures();
        // No purchase into this warehouse -- balance is 0.
        await expect(
            TransferService.create({
                item_id: item.id,
                from_warehouse_id: warehouse.id,
                to_house_id: house.id,
                quantity: 10,
                unit: "G",
                recorded_by_id: profile.id,
            }),
        ).rejects.toMatchObject({ status: 409 });
    });

    test("rejects a unit that isn't usable for the item", async () => {
        const { item, warehouse, house, profile } = await makeFixtures();
        await prisma.itemUnit.create({
            data: { item_id: item.id, unit: "BAG", factor_to_base: 25000, is_purchasable: true, is_usable: false },
        });
        await expect(
            TransferService.create({
                item_id: item.id,
                from_warehouse_id: warehouse.id,
                to_house_id: house.id,
                quantity: 1,
                unit: "BAG",
                recorded_by_id: profile.id,
            }),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("rejects a unit from a different base family", async () => {
        const { item, warehouse, house, profile } = await makeFixtures();
        await expect(
            TransferService.create({
                item_id: item.id,
                from_warehouse_id: warehouse.id,
                to_house_id: house.id,
                quantity: 1,
                unit: "LITER",
                recorded_by_id: profile.id,
            }),
        ).rejects.toMatchObject({ status: 400 });
    });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd server && bun test src/services/transfer.service.test.ts`
Expected: FAIL — `./transfer.service` doesn't exist yet.

- [ ] **Step 4: Implement `TransferService`**

Create `server/src/services/transfer.service.ts`:

```ts
import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toBaseQuantity } from "@lib/unit-conversion";
import { getItemLocationBalance } from "@lib/stock-balance";
import { StockLedgerService } from "@services/stock-ledger.service";
import type { CreateStockTransferInput } from "@validators/transfer.validator";

const include = { item: true, from_warehouse: true, to_house: true } as const;

export const TransferService = {
    async create(data: CreateStockTransferInput) {
        try {
            return await prisma.$transaction(async (tx) => {
                const base_quantity = await toBaseQuantity(
                    tx,
                    data.item_id,
                    data.unit,
                    data.quantity,
                    "USABLE",
                );

                const available = await getItemLocationBalance(
                    tx,
                    data.item_id,
                    "WAREHOUSE",
                    data.from_warehouse_id,
                );
                if (available.lessThan(base_quantity)) {
                    throw AppError.conflict(
                        `Only ${available.toString()} of this item is available at this warehouse`,
                    );
                }

                const transfer = await tx.stockTransfer.create({
                    data: {
                        item_id: data.item_id,
                        from_warehouse_id: data.from_warehouse_id,
                        to_house_id: data.to_house_id,
                        quantity: data.quantity,
                        unit: data.unit,
                        base_quantity,
                        recorded_by_id: data.recorded_by_id,
                        idempotency_key: data.idempotency_key ?? crypto.randomUUID(),
                        ...(data.note !== undefined && { note: data.note }),
                    },
                    include,
                });

                await StockLedgerService.record(tx, {
                    item_id: data.item_id,
                    quantity: base_quantity,
                    direction: "OUT",
                    reason: "TRANSFER",
                    ref_type: "TRANSFER",
                    ref_id: transfer.id,
                    location_type: "WAREHOUSE",
                    location_id: data.from_warehouse_id,
                });
                await StockLedgerService.record(tx, {
                    item_id: data.item_id,
                    quantity: base_quantity,
                    direction: "IN",
                    reason: "TRANSFER",
                    ref_type: "TRANSFER",
                    ref_id: transfer.id,
                    location_type: "HOUSE",
                    location_id: data.to_house_id,
                });

                return transfer;
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },
};
```

(`toBaseQuantity(..., "USABLE")` already rejects a unit that isn't usable for the item, and rejects a unit from a different base family — both via its existing family/purpose checks, reused as-is here.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && bun test src/services/transfer.service.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 6: Write the controller**

Create `server/src/controllers/transfer.controller.ts`:

```ts
import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess } from "@lib/response";
import { getValid } from "@lib/valid";
import { TransferService } from "@services/transfer.service";
import type { CreateStockTransferInput } from "@validators/transfer.validator";

export const TransferController = {
    async create(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<CreateStockTransferInput>(c, "json");
            const transfer = await TransferService.create(body);
            return sendSuccess(c, transfer, "Stock transfer recorded", 201);
        });
    },
};
```

- [ ] **Step 7: Write the routes**

Create `server/src/routes/transfer.routes.ts`:

```ts
import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { TransferController } from "@controllers/transfer.controller";
import { createStockTransferSchema } from "@validators/transfer.validator";

export const transferRoutes = new Hono();

transferRoutes.post(
    "/",
    zValidatorRfc7807("json", createStockTransferSchema),
    TransferController.create,
);
```

- [ ] **Step 8: Register the route**

In `server/src/routes/index.ts`, add the import alongside the other route imports:

```ts
import { transferRoutes } from "@routes/transfer.routes";
```

And add the registration alongside `appRoutes.route("/inventory-adjustments", inventoryAdjustmentRoutes);`:

```ts
appRoutes.route("/stock-transfers", transferRoutes);
```

- [ ] **Step 9: Typecheck and full regression**

```bash
cd server
bunx tsc --noEmit
bun test
```
Expected: no errors, all tests pass.

- [ ] **Step 10: Live-verify the endpoint**

Restart the dev server so the new route is live (Prisma client was already regenerated in Task 1, but a fresh `bun --hot` process picks up new route files immediately on save — a restart here is just to get a clean baseline):

```bash
pkill -f "bun --hot index.ts" 2>/dev/null; sleep 1
cd server
set -a && source .env && set +a
nohup bun --hot index.ts > /tmp/fms-server.log 2>&1 & disown
sleep 1.5
curl -s "http://localhost:5085/api/stock-transfers" -X POST -H "Content-Type: application/json" -d '{}' | python3 -m json.tool
```
Expected: a 400 Validation failed response (not a 404 or 500) — confirms the route is registered and the validator runs.

- [ ] **Step 11: Commit**

```bash
cd server
git add src/validators/transfer.validator.ts src/services/transfer.service.ts src/services/transfer.service.test.ts src/controllers/transfer.controller.ts src/routes/transfer.routes.ts src/routes/index.ts
git commit -m "feat: add POST /stock-transfers"
```

---

### Task 7: `GET /warehouses/:id/stock` and `GET /houses/:id/stock`

**Files:**
- Modify: `server/src/services/warehouse.service.ts`
- Modify: `server/src/services/warehouse.service.test.ts`
- Modify: `server/src/controllers/warehouse.controller.ts`
- Modify: `server/src/routes/warehouse.routes.ts`
- Modify: `server/src/services/house.service.ts`
- Modify: `server/src/services/house.service.test.ts`
- Modify: `server/src/controllers/house.controller.ts`
- Modify: `server/src/routes/house.routes.ts`

**Interfaces:**
- Consumes: `getLocationStock` from Task 2.
- Produces: `GET /warehouses/:id/stock`, `GET /houses/:id/stock` — consumed by the frontend (Tasks 11 and 12).

- [ ] **Step 1: Write the failing tests**

Add to `server/src/services/warehouse.service.test.ts`, inside the existing `describe("WarehouseService", ...)` block:

```ts
    test("getStock returns nonzero item balances at this warehouse only", async () => {
        const warehouse = await WarehouseService.create({ name: `Stock Test Warehouse ${crypto.randomUUID()}` });
        createdIds.push(warehouse.id);
        const item = await prisma.item.create({
            data: {
                name: `Warehouse Stock Item ${crypto.randomUUID()}`,
                normalized_key: `warehouse stock item ${crypto.randomUUID()}`,
                category: "FEED",
                unit: "G",
            },
        });
        await prisma.stockLedger.create({
            data: {
                item_id: item.id, quantity: 300, direction: "IN", reason: "PURCHASE",
                ref_type: "PURCHASE", ref_id: crypto.randomUUID(), idempotency_key: crypto.randomUUID(),
                location_type: "WAREHOUSE", location_id: warehouse.id,
            },
        });

        const stock = await WarehouseService.getStock(warehouse.id);
        expect(stock).toHaveLength(1);
        expect(stock[0]!.item_id).toBe(item.id);
        expect(stock[0]!.item_name).toBe(item.name);
        expect(stock[0]!.balance.toNumber()).toBe(300);

        await prisma.stockLedger.deleteMany({ where: { item_id: item.id } });
        await prisma.item.delete({ where: { id: item.id } });
    });

    test("getStock throws not-found for an unknown warehouse", async () => {
        await expect(
            WarehouseService.getStock("00000000-0000-0000-0000-000000000000"),
        ).rejects.toBeInstanceOf(AppError);
    });
```

Add to `server/src/services/house.service.test.ts`, inside the existing `describe("HouseService", ...)` block:

```ts
    test("getStock returns nonzero item balances at this house only", async () => {
        const house = await HouseService.create({
            name: "Stock Test House",
            type: "GROWER",
            number: Math.floor(Math.random() * 100000),
        });
        createdIds.push(house.id);
        const item = await prisma.item.create({
            data: {
                name: `House Stock Item ${crypto.randomUUID()}`,
                normalized_key: `house stock item ${crypto.randomUUID()}`,
                category: "FEED",
                unit: "G",
            },
        });
        await prisma.stockLedger.create({
            data: {
                item_id: item.id, quantity: 60, direction: "IN", reason: "TRANSFER",
                ref_type: "TRANSFER", ref_id: crypto.randomUUID(), idempotency_key: crypto.randomUUID(),
                location_type: "HOUSE", location_id: house.id,
            },
        });

        const stock = await HouseService.getStock(house.id);
        expect(stock).toHaveLength(1);
        expect(stock[0]!.item_id).toBe(item.id);
        expect(stock[0]!.balance.toNumber()).toBe(60);

        await prisma.stockLedger.deleteMany({ where: { item_id: item.id } });
        await prisma.item.delete({ where: { id: item.id } });
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd server
bun test src/services/warehouse.service.test.ts -t "getStock"
bun test src/services/house.service.test.ts -t "getStock"
```
Expected: FAIL — `getStock` doesn't exist on either service yet.

- [ ] **Step 3: Implement `WarehouseService.getStock`**

In `server/src/services/warehouse.service.ts`, add this import:

```ts
import { getLocationStock } from "@lib/stock-balance";
```

And add this method to the `WarehouseService` object (after `getById`, before `create`):

```ts
    async getStock(id: string) {
        const warehouse = await prisma.warehouses.findUnique({ where: { id } });
        if (!warehouse) throw AppError.notFound("Warehouse");

        const balances = await getLocationStock("WAREHOUSE", id);
        const nonZero = balances.filter((b) => !b.balance.isZero());
        const items = await prisma.item.findMany({
            where: { id: { in: nonZero.map((b) => b.item_id) } },
            select: { id: true, name: true, unit: true },
        });
        const itemById = new Map(items.map((i) => [i.id, i]));

        return nonZero.map((b) => ({
            item_id: b.item_id,
            item_name: itemById.get(b.item_id)?.name ?? "Unknown item",
            unit: itemById.get(b.item_id)?.unit ?? "",
            balance: b.balance,
        }));
    },
```

- [ ] **Step 4: Implement `HouseService.getStock`**

In `server/src/services/house.service.ts`, add the same import:

```ts
import { getLocationStock } from "@lib/stock-balance";
```

And add this method to the `HouseService` object (find `getById`, add this method right after it):

```ts
    async getStock(id: string) {
        const house = await prisma.houses.findUnique({ where: { id } });
        if (!house) throw AppError.notFound("House");

        const balances = await getLocationStock("HOUSE", id);
        const nonZero = balances.filter((b) => !b.balance.isZero());
        const items = await prisma.item.findMany({
            where: { id: { in: nonZero.map((b) => b.item_id) } },
            select: { id: true, name: true, unit: true },
        });
        const itemById = new Map(items.map((i) => [i.id, i]));

        return nonZero.map((b) => ({
            item_id: b.item_id,
            item_name: itemById.get(b.item_id)?.name ?? "Unknown item",
            unit: itemById.get(b.item_id)?.unit ?? "",
            balance: b.balance,
        }));
    },
```

(This duplicates `WarehouseService.getStock`'s body except the `prisma.warehouses`/`prisma.houses`/`AppError.notFound` resource name — deliberately not extracted into a shared helper; both services already independently own their `getAll`/`getById`/`create` shape, and the duplication here is 12 lines, well under the threshold where a shared abstraction would pay for itself over just reading the two copies.)

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd server
bun test src/services/warehouse.service.test.ts
bun test src/services/house.service.test.ts
```
Expected: PASS, all tests in both files.

- [ ] **Step 6: Add the controller methods**

In `server/src/controllers/warehouse.controller.ts`, add this method to `WarehouseController` (after `getById`):

```ts
    async getStock(c: Context) {
        return withHandler(c, async () => {
            const stock = await WarehouseService.getStock(c.req.param("id") ?? "");
            return sendSuccess(c, stock, "Warehouse stock fetched successfully");
        });
    },
```

In `server/src/controllers/house.controller.ts`, add this method to `HouseController` (after `getById` — check the file for its exact existing method order first):

```ts
    async getStock(c: Context) {
        return withHandler(c, async () => {
            const stock = await HouseService.getStock(c.req.param("id") ?? "");
            return sendSuccess(c, stock, "House stock fetched successfully");
        });
    },
```

- [ ] **Step 7: Register the routes**

In `server/src/routes/warehouse.routes.ts`, add after the existing `warehouseRoutes.get("/:id", WarehouseController.getById);`:

```ts
warehouseRoutes.get("/:id/stock", WarehouseController.getStock);
```

In `server/src/routes/house.routes.ts`, add after the existing `houseRoutes.get("/:id", HouseController.getById);`:

```ts
houseRoutes.get("/:id/stock", HouseController.getStock);
```

- [ ] **Step 8: Typecheck and full regression**

```bash
cd server
bunx tsc --noEmit
bun test
```
Expected: no errors, all tests pass.

- [ ] **Step 9: Live-verify both endpoints**

```bash
pkill -f "bun --hot index.ts" 2>/dev/null; sleep 1
cd server
set -a && source .env && set +a
nohup bun --hot index.ts > /tmp/fms-server.log 2>&1 & disown
sleep 1.5
WAREHOUSE_ID=$(curl -s "http://localhost:5085/api/warehouses?limit=1" | python3 -c "import sys,json; print(json.load(sys.stdin)['data'][0]['id'])")
HOUSE_ID=$(curl -s "http://localhost:5085/api/houses?limit=1" | python3 -c "import sys,json; print(json.load(sys.stdin)['data'][0]['id'])")
curl -s "http://localhost:5085/api/warehouses/$WAREHOUSE_ID/stock" | python3 -m json.tool
curl -s "http://localhost:5085/api/houses/$HOUSE_ID/stock" | python3 -m json.tool
```
Expected: both return `200` with `"data": []` (or populated rows if that warehouse/house already has tagged ledger entries) — not a 404 or 500.

- [ ] **Step 10: Merge Part A to `main`**

This is the last backend task — run the full suite one more time, then merge:

```bash
cd server
bunx tsc --noEmit
bun test
git add src/services/warehouse.service.ts src/services/warehouse.service.test.ts src/controllers/warehouse.controller.ts src/routes/warehouse.routes.ts src/services/house.service.ts src/services/house.service.test.ts src/controllers/house.controller.ts src/routes/house.routes.ts
git commit -m "feat: add GET /warehouses/:id/stock and GET /houses/:id/stock"
git checkout main
git merge --no-ff feat/warehouse-house-stock-transfer -m "Merge feat/warehouse-house-stock-transfer"
git branch -d feat/warehouse-house-stock-transfer
```

Restart the dev server one final time so `main`'s code is what's actually running for Part B's frontend work:

```bash
pkill -f "bun --hot index.ts" 2>/dev/null; sleep 1
cd server
set -a && source .env && set +a
nohup bun --hot index.ts > /tmp/fms-server.log 2>&1 & disown
```

---

## Part B — Frontend (`web/` repo)

### Task 8: Types

**Files:**
- Modify: `web/src/pages/purchases/types.ts`
- Modify: `web/src/pages/inventory/types.ts`

**Interfaces:**
- Produces: `Purchase.warehouse_id`, `LocationStockRow` — Tasks 10, 11, 12 all import `LocationStockRow`.

- [ ] **Step 1: Add `warehouse_id` to the `Purchase` type**

In `web/src/pages/purchases/types.ts`, find the `Purchase` type's `supplier_id` field and add `warehouse_id` right after it:

```ts
export type Purchase = {
  id: string;
  supplier_id: string | null;
  warehouse_id: string | null;
  invoice_no: string | null;
  purchase_date: string;
  discount_type: DiscountType | null;
  discount_value: string | null;
  total_amount: string;
  paid_amount: string;
  due_amount: string;
  recorded_by_id: string;
  created_at: string;
  items: PurchaseItemLine[];
  // Purchase's `include` nests the Supplier row itself, but not its Profile —
  // unlike GET /api/suppliers, this has no `name`/`mobile`. Look those up
  // separately (see supplierName() usage in the list/detail pages).
  supplier: { id: string; company: string | null } | null;
};
```

(Only the `warehouse_id` line is new — the rest is the file's current content, shown for exact placement. Verify against the actual current file before editing, since other fields may have shifted since this plan was written.)

- [ ] **Step 2: Add `LocationStockRow` to inventory types**

In `web/src/pages/inventory/types.ts`, add this type near the existing `Warehouse` type:

```ts
/** GET /warehouses/:id/stock and GET /houses/:id/stock response row -- current on-hand
 * balance for one item at that location. */
export type LocationStockRow = {
  item_id: string;
  item_name: string;
  unit: string;
  balance: string;
};
```

- [ ] **Step 3: Typecheck**

Run: `cd web && bunx tsc -b`
Expected: no new errors (the pre-existing unrelated `sidebar.tsx` `useTheme` error may still be present — that's not from this change).

- [ ] **Step 4: Create the branch and commit**

```bash
cd web
git checkout -b feat/warehouse-house-stock-transfer
git add src/pages/purchases/types.ts src/pages/inventory/types.ts
git commit -m "feat: add warehouse_id and LocationStockRow types"
```

---

### Task 9: Purchase form — required Warehouse select

**Files:**
- Modify: `web/src/pages/purchases/purchase-create-page.tsx`

**Interfaces:**
- Consumes: `Warehouse` type (already exists in `@/pages/inventory/types`).

- [ ] **Step 1: Add `warehouse_id` to the form schema**

In `purchase-create-page.tsx`, find `purchaseSchema` (currently starts `supplier_id: z.string().optional(),`) and add a field right after it:

```ts
const purchaseSchema = z.object({
  supplier_id: z.string().optional(),
  warehouse_id: z.string().min(1, "Select a warehouse"),
  invoice_no: z.string().trim().optional(),
  purchase_date: z.string().min(1, "Purchase date is required"),
  discount_type: z.enum(DISCOUNT_TYPES).optional(),
  discount_value: z.coerce.number().nonnegative().optional(),
  items: z.array(lineSchema).min(1, "Add at least one line item"),
});
```

- [ ] **Step 2: Add `warehouse_id` to `defaultValues`**

Find the `useForm` call's `defaultValues` (currently starts `supplier_id: "",`) and add:

```ts
    defaultValues: {
      supplier_id: "",
      warehouse_id: "",
      invoice_no: "",
      purchase_date: new Date().toISOString().slice(0, 10),
      discount_type: undefined,
      discount_value: undefined,
      items: [blankLine()],
    },
```

- [ ] **Step 3: Fetch warehouses**

Find the existing `const { data: suppliers } = useGetData<Paginated<Supplier>>(...)` line and add right after it:

```ts
  const { data: warehouses } = useGetData<Paginated<Warehouse>>("/warehouses?limit=100", ["warehouses"]);
```

Add `Warehouse` to the existing inventory-types import at the top of the file (currently `import type { Item } from "@/pages/inventory/types";`):

```ts
import type { Item, Warehouse } from "@/pages/inventory/types";
```

- [ ] **Step 4: Add the Warehouse select to the "Purchase details" card**

Find the `CardContent className="grid grid-cols-3 gap-4"` block inside the "Purchase details" `Card`. Change `grid-cols-3` to `grid-cols-4` and add a Warehouse field. The block currently is:

```tsx
          <CardContent className="grid grid-cols-3 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="supplier_id">Supplier (optional)</Label>
              <Controller
                control={control}
                name="supplier_id"
                render={({ field }) => (
                  <Select value={field.value ?? ""} onValueChange={field.onChange}>
                    <SelectTrigger id="supplier_id" className="w-full">
                      <SelectValue>
                        {(v: string) => suppliers?.results.find((s) => s.id === v)?.profile.name ?? "None"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(suppliers?.results ?? []).map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.profile.name}
                          {s.company ? ` (${s.company})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invoice_no">Invoice number (optional)</Label>
              <Input id="invoice_no" {...register("invoice_no")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="purchase_date">Purchase date</Label>
              <Input
                id="purchase_date"
                type="date"
                {...register("purchase_date")}
                aria-invalid={!!errors.purchase_date}
              />
              {errors.purchase_date && <p className="text-xs text-destructive">{errors.purchase_date.message}</p>}
            </div>
          </CardContent>
```

Change to:

```tsx
          <CardContent className="grid grid-cols-4 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="supplier_id">Supplier (optional)</Label>
              <Controller
                control={control}
                name="supplier_id"
                render={({ field }) => (
                  <Select value={field.value ?? ""} onValueChange={field.onChange}>
                    <SelectTrigger id="supplier_id" className="w-full">
                      <SelectValue>
                        {(v: string) => suppliers?.results.find((s) => s.id === v)?.profile.name ?? "None"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(suppliers?.results ?? []).map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.profile.name}
                          {s.company ? ` (${s.company})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="warehouse_id">Warehouse</Label>
              <Controller
                control={control}
                name="warehouse_id"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="warehouse_id" className="w-full" aria-invalid={!!errors.warehouse_id}>
                      <SelectValue>
                        {(v: string) => warehouses?.results.find((w) => w.id === v)?.name ?? "Select warehouse"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(warehouses?.results ?? []).map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.warehouse_id && <p className="text-xs text-destructive">{errors.warehouse_id.message}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invoice_no">Invoice number (optional)</Label>
              <Input id="invoice_no" {...register("invoice_no")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="purchase_date">Purchase date</Label>
              <Input
                id="purchase_date"
                type="date"
                {...register("purchase_date")}
                aria-invalid={!!errors.purchase_date}
              />
              {errors.purchase_date && <p className="text-xs text-destructive">{errors.purchase_date.message}</p>}
            </div>
          </CardContent>
```

- [ ] **Step 5: Verify the payload build needs no change**

`onSubmit`'s `payload` is built with `{ ...values, supplier_id: values.supplier_id || undefined, invoice_no: values.invoice_no || undefined, recorded_by_id, paid_amount: 0, items: [...] }` — since `warehouse_id` is now a required field inside `values`, the `...values` spread already includes it in the payload. No change needed here.

- [ ] **Step 6: Typecheck, lint, build**

```bash
cd web
bunx tsc -b
bunx eslint src/pages/purchases/purchase-create-page.tsx
bunx vite build
```
Expected: no new errors/warnings, build succeeds.

- [ ] **Step 7: Live-verify**

Navigate to `http://localhost:5173/purchases/new` via Playwright (`browser_navigate`), confirm a "Warehouse" select now appears next to Supplier, and that submitting the form without picking one shows the "Select a warehouse" validation error instead of posting.

- [ ] **Step 8: Commit**

```bash
cd web
git add src/pages/purchases/purchase-create-page.tsx
git commit -m "feat: require a Warehouse on the purchase form"
```

---

### Task 10: `TransferFormDialog` + "Transfer to house" button

**Files:**
- Create: `web/src/pages/inventory/transfer-form-dialog.tsx`
- Modify: `web/src/pages/inventory/stock-ledger-tab.tsx`

**Interfaces:**
- Consumes: `LocationStockRow` (Task 8), `Item`/`Warehouse` types, `LAST_ADMIN_KEY` (`@/components/shared/actor-select`), `NumericInput` (`@/components/utils/NumaricInput`).

- [ ] **Step 1: Create the dialog**

Create `web/src/pages/inventory/transfer-form-dialog.tsx`:

```tsx
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NumericInput } from "@/components/utils/NumaricInput";
import { LAST_ADMIN_KEY } from "@/components/shared/actor-select";
import { useGetData, usePostData, type Paginated } from "@/lib/api";
import { humanizeEnum } from "@/lib/utils";
import type { Item, Warehouse, LocationStockRow } from "@/pages/inventory/types";
import type { House } from "@/pages/houses/types";
import type { LookupRow } from "@/pages/settings/lookup-types";

type Admin = { id: string; profile: { id: string; name: string } };

const transferSchema = z.object({
  item_id: z.string().min(1, "Select an item"),
  from_warehouse_id: z.string().min(1, "Select a warehouse"),
  to_house_id: z.string().min(1, "Select a house"),
  quantity: z.coerce.number().positive("Quantity must be positive"),
  unit: z.string().min(1, "Select a unit"),
  note: z.string().optional(),
});

type TransferFormInput = z.input<typeof transferSchema>;
type TransferFormValues = z.output<typeof transferSchema>;

type TransferFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function TransferFormDialog({ open, onOpenChange }: TransferFormDialogProps) {
  const {
    control,
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<TransferFormInput, unknown, TransferFormValues>({
    resolver: zodResolver(transferSchema),
    defaultValues: {
      item_id: "",
      from_warehouse_id: "",
      to_house_id: "",
      quantity: undefined,
      unit: "",
      note: "",
    },
  });

  const { data: items } = useGetData<Paginated<Item>>("/items?limit=100", ["items"]);
  const { data: warehouses } = useGetData<Paginated<Warehouse>>("/warehouses?limit=100", ["warehouses"]);
  const { data: houses } = useGetData<Paginated<House>>("/houses?limit=100", ["houses"]);
  const { data: admins } = useGetData<Paginated<Admin>>("/admins?limit=100", ["admins"]);
  const { data: units } = useGetData<Paginated<LookupRow>>("/units?active=true&limit=100", ["units", "active"]);
  const unitLabel = (code: string) => units?.results.find((u) => u.code === code)?.label ?? humanizeEnum(code);

  const itemId = useWatch({ control, name: "item_id" });
  const fromWarehouseId = useWatch({ control, name: "from_warehouse_id" });

  const selectedItem = items?.results.find((i) => i.id === itemId);
  const usableUnits = [
    ...(selectedItem ? [{ code: selectedItem.unit, label: unitLabel(selectedItem.unit) }] : []),
    ...(selectedItem?.itemUnits ?? [])
      .filter((u) => u.is_usable)
      .map((u) => ({ code: u.unit, label: unitLabel(u.unit) })),
  ];

  const { data: warehouseStock } = useGetData<LocationStockRow[]>(
    `/warehouses/${fromWarehouseId}/stock`,
    ["warehouses", fromWarehouseId, "stock"],
    { enabled: !!fromWarehouseId }
  );
  const availableAtWarehouse = warehouseStock?.find((s) => s.item_id === itemId);

  const queryClient = useQueryClient();
  const createTransfer = usePostData<unknown, Record<string, unknown>>("/stock-transfers", ["stock-ledger"]);

  const resolveRecordedBy = (): string | null => {
    const admin = admins?.results ?? [];
    const stored = localStorage.getItem(LAST_ADMIN_KEY);
    if (stored && admin.some((a) => a.profile.id === stored)) return stored;
    const fallback = admin[0]?.profile.id;
    if (fallback) localStorage.setItem(LAST_ADMIN_KEY, fallback);
    return fallback ?? null;
  };

  const onSubmit = (values: TransferFormValues) => {
    const recorded_by_id = resolveRecordedBy();
    if (!recorded_by_id) {
      toast.error("No admins exist yet — add one before recording a transfer.");
      return;
    }

    createTransfer.mutate(
      {
        item_id: values.item_id,
        from_warehouse_id: values.from_warehouse_id,
        to_house_id: values.to_house_id,
        quantity: values.quantity,
        unit: values.unit,
        recorded_by_id,
        ...(values.note && { note: values.note }),
      },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: ["stock-ledger"] });
          void queryClient.invalidateQueries({ queryKey: ["items"] });
          void queryClient.invalidateQueries({ queryKey: ["warehouses"] });
          void queryClient.invalidateQueries({ queryKey: ["houses"] });
          toast.success("Stock transferred");
          reset();
          onOpenChange(false);
        },
        onError: (error) => toast.error(error.message),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transfer to house</DialogTitle>
          <DialogDescription>Move stock from a warehouse to a house, before it's used.</DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="item_id">Item</Label>
            <Controller
              control={control}
              name="item_id"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={(v) => {
                    field.onChange(v);
                    setValue("unit", "");
                  }}
                >
                  <SelectTrigger id="item_id" className="w-full" aria-invalid={!!errors.item_id}>
                    <SelectValue>
                      {(v: string) => items?.results.find((i) => i.id === v)?.name ?? "Select item"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(items?.results ?? []).map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.item_id && <p className="text-xs text-destructive">{errors.item_id.message}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="quantity">Quantity</Label>
            <div className="flex gap-2">
              <NumericInput
                id="quantity"
                allowDecimal
                decimalPlaces={3}
                className="flex-1"
                {...register("quantity")}
                aria-invalid={!!errors.quantity}
              />
              <Controller
                control={control}
                name="unit"
                render={({ field }) => (
                  <Select value={field.value ?? ""} onValueChange={field.onChange} disabled={!selectedItem}>
                    <SelectTrigger className="w-32">
                      <SelectValue>{(v: string) => (v ? unitLabel(v) : "Unit")}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {usableUnits.map((u) => (
                        <SelectItem key={u.code} value={u.code}>
                          {u.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            {errors.quantity && <p className="text-xs text-destructive">{errors.quantity.message}</p>}
            {errors.unit && <p className="text-xs text-destructive">{errors.unit.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="from_warehouse_id">From warehouse</Label>
              <Controller
                control={control}
                name="from_warehouse_id"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger
                      id="from_warehouse_id"
                      className="w-full"
                      aria-invalid={!!errors.from_warehouse_id}
                    >
                      <SelectValue>
                        {(v: string) => warehouses?.results.find((w) => w.id === v)?.name ?? "Select warehouse"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(warehouses?.results ?? []).map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.from_warehouse_id && (
                <p className="text-xs text-destructive">{errors.from_warehouse_id.message}</p>
              )}
              {availableAtWarehouse && (
                <p className="text-xs text-muted-foreground">
                  Available: {availableAtWarehouse.balance} {availableAtWarehouse.unit}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="to_house_id">To house</Label>
              <Controller
                control={control}
                name="to_house_id"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="to_house_id" className="w-full" aria-invalid={!!errors.to_house_id}>
                      <SelectValue>
                        {(v: string) => houses?.results.find((h) => h.id === v)?.name ?? "Select house"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(houses?.results ?? []).map((h) => (
                        <SelectItem key={h.id} value={h.id}>
                          {h.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.to_house_id && <p className="text-xs text-destructive">{errors.to_house_id.message}</p>}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="note">Note (optional)</Label>
            <Input id="note" {...register("note")} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              Transfer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Wire the button into the Stock Ledger tab**

In `web/src/pages/inventory/stock-ledger-tab.tsx`, add `ArrowRightLeft` to the existing lucide-react import (currently `import { BookText, PackageMinus, PackagePlus, Plus } from "lucide-react";`):

```ts
import { ArrowRightLeft, BookText, PackageMinus, PackagePlus, Plus } from "lucide-react";
```

Add the dialog import alongside the existing one:

```ts
import { TransferFormDialog } from "@/pages/inventory/transfer-form-dialog";
```

Add a new state variable alongside `openingBalanceOpen`:

```ts
  const [transferOpen, setTransferOpen] = useState(false);
```

Find this block:

```tsx
      <div className="flex items-center justify-end">
        <Button onClick={() => setOpeningBalanceOpen(true)}>
          <Plus />
          Record opening balance
        </Button>
      </div>
```

Change to:

```tsx
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" onClick={() => setTransferOpen(true)}>
          <ArrowRightLeft />
          Transfer to house
        </Button>
        <Button onClick={() => setOpeningBalanceOpen(true)}>
          <Plus />
          Record opening balance
        </Button>
      </div>
```

Find the `<AdjustmentFormDialog .../>` at the bottom of the component and add the new dialog right before it:

```tsx
      <TransferFormDialog open={transferOpen} onOpenChange={setTransferOpen} />
      <AdjustmentFormDialog open={openingBalanceOpen} onOpenChange={setOpeningBalanceOpen} openingBalance />
```

- [ ] **Step 3: Typecheck, lint, build**

```bash
cd web
bunx tsc -b
bunx eslint src/pages/inventory/transfer-form-dialog.tsx src/pages/inventory/stock-ledger-tab.tsx
bunx vite build
```
Expected: no new errors/warnings, build succeeds.

- [ ] **Step 4: Live-verify**

Via Playwright: navigate to `/inventory`, open the Stock Ledger tab, confirm the "Transfer to house" button appears, click it, select an item that has warehouse stock (from Task 9's live-verified purchase), select a from-warehouse and to-house, submit, and confirm both a "+X" and a "-X" row show up in the ledger table with reason "Transfer".

- [ ] **Step 5: Commit**

```bash
cd web
git add src/pages/inventory/transfer-form-dialog.tsx src/pages/inventory/stock-ledger-tab.tsx
git commit -m "feat: add Transfer to house dialog"
```

---

### Task 11: House detail page — "View stock" dialog

**Files:**
- Create: `web/src/pages/houses/house-stock-dialog.tsx`
- Modify: `web/src/pages/houses/house-detail-page.tsx`

**Interfaces:**
- Consumes: `LocationStockRow` (Task 8).

- [ ] **Step 1: Create the dialog**

Create `web/src/pages/houses/house-stock-dialog.tsx`:

```tsx
import { Package } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DataTable, type Column } from "@/components/shared/data-table";
import { useGetData } from "@/lib/api";
import type { LocationStockRow } from "@/pages/inventory/types";

type HouseStockDialogProps = {
  houseId: string;
  houseName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function HouseStockDialog({ houseId, houseName, open, onOpenChange }: HouseStockDialogProps) {
  const { data: stock, isLoading } = useGetData<LocationStockRow[]>(
    `/houses/${houseId}/stock`,
    ["houses", houseId, "stock"],
    { enabled: open }
  );

  const columns: Column<LocationStockRow>[] = [
    { key: "item", header: "Item", render: (row) => row.item_name },
    { key: "balance", header: "On hand", render: (row) => `${row.balance} ${row.unit}`, numeric: true },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Stock at {houseName}</DialogTitle>
          <DialogDescription>Items currently on hand here, transferred but not yet used.</DialogDescription>
        </DialogHeader>
        <DataTable
          columns={columns}
          rows={stock ?? []}
          rowKey={(row) => row.item_id}
          isLoading={isLoading}
          empty={{ icon: Package, title: "Nothing on hand here yet" }}
        />
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Wire the button into the house detail page**

In `web/src/pages/houses/house-detail-page.tsx`, add `Package` to the existing lucide-react import (currently `import { ArrowLeft, Bird, Pencil, Skull, Thermometer } from "lucide-react";`):

```ts
import { ArrowLeft, Bird, Package, Pencil, Skull, Thermometer } from "lucide-react";
```

Add the dialog import alongside `HouseFormDialog`:

```ts
import { HouseStockDialog } from "@/pages/houses/house-stock-dialog";
```

Add a new state variable alongside `editOpen`:

```ts
  const [stockOpen, setStockOpen] = useState(false);
```

Find this block in the header's action buttons:

```tsx
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil />
              Edit
            </Button>
            <Button
              variant={house.is_active ? "destructive" : "default"}
              size="sm"
              onClick={toggleActive}
              disabled={deactivate.isPending || reactivate.isPending}
            >
              {house.is_active ? "Deactivate" : "Reactivate"}
            </Button>
          </div>
```

Change to:

```tsx
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setStockOpen(true)}>
              <Package />
              View stock
            </Button>
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil />
              Edit
            </Button>
            <Button
              variant={house.is_active ? "destructive" : "default"}
              size="sm"
              onClick={toggleActive}
              disabled={deactivate.isPending || reactivate.isPending}
            >
              {house.is_active ? "Deactivate" : "Reactivate"}
            </Button>
          </div>
```

Find `<HouseFormDialog open={editOpen} onOpenChange={setEditOpen} house={house} />` at the bottom of the component and add the new dialog right after it:

```tsx
      <HouseFormDialog open={editOpen} onOpenChange={setEditOpen} house={house} />
      <HouseStockDialog houseId={house.id} houseName={house.name} open={stockOpen} onOpenChange={setStockOpen} />
```

- [ ] **Step 3: Typecheck, lint, build**

```bash
cd web
bunx tsc -b
bunx eslint src/pages/houses/house-stock-dialog.tsx src/pages/houses/house-detail-page.tsx
bunx vite build
```
Expected: no new errors/warnings, build succeeds.

- [ ] **Step 4: Live-verify**

Via Playwright: navigate to a house's detail page, click "View stock", confirm the dialog opens and shows the item transferred in Task 10 with its correct balance.

- [ ] **Step 5: Commit**

```bash
cd web
git add src/pages/houses/house-stock-dialog.tsx src/pages/houses/house-detail-page.tsx
git commit -m "feat: add View stock dialog to house detail page"
```

---

### Task 12: End-to-end verification and merge

**Files:** none (verification only).

- [ ] **Step 1: Full regression**

```bash
cd web
bunx tsc -b
bunx eslint src/pages/purchases/purchase-create-page.tsx src/pages/inventory/transfer-form-dialog.tsx src/pages/inventory/stock-ledger-tab.tsx src/pages/houses/house-stock-dialog.tsx src/pages/houses/house-detail-page.tsx src/pages/purchases/types.ts src/pages/inventory/types.ts
bunx vite build
```
Expected: no errors, build succeeds. (Only the pre-existing unrelated `sidebar.tsx` tsc error, if it's still present on `main`, is acceptable — confirm via `git stash` + `bunx tsc -b` that it predates this branch, same check used throughout this session.)

- [ ] **Step 2: Live walk of the full feature, via Playwright against the running dev server**

1. Navigate to `/purchases/new`. Record a purchase of some item, selecting a Warehouse. Confirm success.
2. Navigate to `/inventory`, Stock Ledger tab. Confirm the purchase's `+` entry is tagged `WAREHOUSE` implicitly (visible via the existing Movement column; location isn't rendered in the table, but the next step proves it was tagged correctly).
3. Click "Transfer to house". Select the same item, a quantity within what was purchased, the same from-warehouse, and any house. Submit. Confirm two new rows appear in the ledger (`+`/`-`), and that the "Available: X" hint text updated correctly before submitting.
4. Navigate to that house's detail page. Click "View stock". Confirm the transferred item and quantity show up.
5. Record a Consumption at that same house (via whichever existing flow creates one — e.g. the feeding-program tab) for **more** than what was transferred. Confirm it's rejected with a clear "only X on hand at this house" error, not a generic failure.
6. Record a Consumption at that house for an amount **within** the transferred balance. Confirm it succeeds, and that "View stock" on the house now shows the reduced balance.

If any step fails, stop and fix the root cause in the relevant task's files before proceeding — do not patch around it in this verification task.

- [ ] **Step 3: Merge to `main`**

```bash
cd web
git checkout main
git merge --no-ff feat/warehouse-house-stock-transfer -m "Merge feat/warehouse-house-stock-transfer"
git branch -d feat/warehouse-house-stock-transfer
```
