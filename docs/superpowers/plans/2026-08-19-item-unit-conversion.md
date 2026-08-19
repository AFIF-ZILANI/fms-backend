# Item Unit Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an item be purchased in one unit and consumed in another (feed: MT/Bag vs Kg; liquid medicine: Liter vs mL), with every quantity that reaches `StockLedger`/avg-cost normalized to the item's base unit, and the originally-entered unit preserved for audit.

**Architecture:** A new `ItemUnit` table stores a per-item, per-unit `factor_to_base` (e.g. Feed's `BAG` = 50, meaning 1 BAG = 50 of `Item.unit`). A shared `toBaseQuantity()` helper resolves any entered `(item_id, unit, quantity)` to a `Prisma.Decimal` in the item's base unit, used by both `PurchaseService.create` and `ConsumptionService.create` before anything is written to `StockLedger` or `StockUnit.remaining_quantity`. `PurchaseItem`/`Consumption` keep their raw entered `quantity`/`unit` and gain a snapshotted `base_quantity` column alongside.

**Tech Stack:** Bun, Hono, Prisma (Postgres), Zod, `bun:test` (real-DB integration tests, no mocking).

**Spec:** `docs/superpowers/specs/2026-08-19-item-unit-conversion-design.md`

## Global Constraints

- All quantity/money math uses `Prisma.Decimal`, never native JS numbers (see `Employees.salary` Decimal-not-Float precedent).
- `Purchase`/`PurchaseItem` are append-only — no update path is added; a correction is a new `Purchase`.
- Tests are real-DB integration tests via `bun:test` (see `src/services/*.test.ts`) — no mocking Prisma.
- Errors go through `AppError`/`handlePrismaWriteError` → RFC 7807 responses; never a raw throw from a service.
- Reuse existing `Unit` lookup codes already seeded in the dev DB — do not invent new ones in tests unless the scenario needs a code that doesn't exist yet: currently seeded codes include `KG, BAG, LITER, L, ML, G, PCS, BOTTLE, VIAL, DOSE, BOX, UNIT, SACHETS, BIRD, OTHER`.
- Path aliases (`@lib`, `@services`, `@validators`, `@controllers`, `@routes`) are defined in both `tsconfig.json` and `bunfig.toml` — new files under `src/` automatically resolve through them, no config changes needed.

---

## Task 1: Schema — `ItemUnit` table, `PurchaseItem.base_quantity`, `Consumption.unit`/`base_quantity`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_item_unit_conversion/migration.sql`

**Interfaces:**
- Produces: `ItemUnit` model (`item_id`, `unit`, `factor_to_base`), `PurchaseItem.base_quantity: Decimal`, `Consumption.unit: string` + `Consumption.base_quantity: Decimal`. Every later task depends on these three columns existing and the Prisma client being regenerated.

- [ ] **Step 1: Edit `prisma/schema.prisma`**

Add `itemUnits ItemUnit[]` to the `Item` model, right after its `suppliers` relation line:

```prisma
model Item {
  ...
  purchaseItems        PurchaseItem[]
  ledgerEntries        StockLedger[]
  consumptions         Consumption[]
  saleItems            SaleItem[]
  suppliers            Suppliers[]
  itemUnits            ItemUnit[]
  feedingPrograms      BatchFeedingProgram[]
  itemOrganizations    ItemOrganization[]
  inventoryAdjustments InventoryAdjustment[]

  @@index([category])
}

model ItemUnit {
  id             String   @id @default(uuid())
  item_id        String
  item           Item     @relation(fields: [item_id], references: [id], onDelete: Cascade)
  unit           String
  unitRef        Unit     @relation(fields: [unit], references: [code], onUpdate: Cascade)
  factor_to_base Decimal  @db.Decimal(10, 4) // 1 of `unit` = this many of Item.unit
  created_at     DateTime @default(now())

  @@unique([item_id, unit])
}
```

Add `itemUnitConversions ItemUnit[]` and `consumptions Consumption[]` to the `Unit` model:

```prisma
model Unit {
  ...
  items               Item[]
  purchaseItems        PurchaseItem[]
  saleItems            SaleItem[]
  itemUnitConversions  ItemUnit[]
  consumptions         Consumption[]
}
```

Add `base_quantity` to `PurchaseItem`, right after its `unitRef` line:

```prisma
model PurchaseItem {
  ...
  quantity        Decimal   @db.Decimal(10, 3)
  unit            String
  unitRef         Unit      @relation(fields: [unit], references: [code], onUpdate: Cascade)
  base_quantity   Decimal   @db.Decimal(10, 3) // quantity converted to Item.unit, snapshotted at write time
  unit_price      Decimal   @db.Decimal(10, 2)
  ...
}
```

Add `unit`/`unitRef`/`base_quantity` to `Consumption`, right after its `quantity` line:

```prisma
model Consumption {
  ...
  quantity        Decimal    @db.Decimal(10, 3) // feed: allocation amount; medicine: dose drawn; equipment: 1 (non-depleting)
  unit            String
  unitRef         Unit       @relation(fields: [unit], references: [code], onUpdate: Cascade)
  base_quantity   Decimal    @db.Decimal(10, 3) // quantity converted to Item.unit, snapshotted at write time
  date            DateTime
  ...
}
```

- [ ] **Step 2: Generate the migration scaffold**

Run: `bunx prisma migrate dev --create-only --name add_item_unit_conversion`

This creates `prisma/migrations/<timestamp>_add_item_unit_conversion/migration.sql` from the schema diff. Its auto-generated content will be incomplete (it doesn't know to backfill `base_quantity`/`unit` for existing rows) — the next step replaces it entirely.

- [ ] **Step 3: Replace the generated migration.sql with this exact content**

```sql
-- CreateTable
CREATE TABLE "ItemUnit" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "factor_to_base" DECIMAL(10,4) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemUnit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ItemUnit_item_id_unit_key" ON "ItemUnit"("item_id", "unit");

-- AddForeignKey
ALTER TABLE "ItemUnit" ADD CONSTRAINT "ItemUnit_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemUnit" ADD CONSTRAINT "ItemUnit_unit_fkey" FOREIGN KEY ("unit") REFERENCES "Unit"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: PurchaseItem gains base_quantity. Backfilled from the existing
-- `quantity` column before being made required -- pre-conversion rows had no
-- other unit to convert from, so their entered quantity is already the only
-- value that could go here.
ALTER TABLE "PurchaseItem" ADD COLUMN "base_quantity" DECIMAL(10,3);
UPDATE "PurchaseItem" SET "base_quantity" = "quantity" WHERE "base_quantity" IS NULL;
ALTER TABLE "PurchaseItem" ALTER COLUMN "base_quantity" SET NOT NULL;

-- AlterTable: Consumption gains unit + base_quantity, backfilled from the
-- owning Item's base unit (same reasoning as PurchaseItem above).
ALTER TABLE "Consumption" ADD COLUMN "unit" TEXT;
ALTER TABLE "Consumption" ADD COLUMN "base_quantity" DECIMAL(10,3);
UPDATE "Consumption" c SET "unit" = i."unit", "base_quantity" = c."quantity"
FROM "Item" i WHERE i.id = c.item_id AND c."unit" IS NULL;
ALTER TABLE "Consumption" ALTER COLUMN "unit" SET NOT NULL;
ALTER TABLE "Consumption" ALTER COLUMN "base_quantity" SET NOT NULL;
ALTER TABLE "Consumption" ADD CONSTRAINT "Consumption_unit_fkey" FOREIGN KEY ("unit") REFERENCES "Unit"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 4: Apply the migration and regenerate the client**

Run: `bunx prisma migrate dev`
Expected: `Applying migration ...add_item_unit_conversion` then `The migration has been applied.`, followed by `prisma generate` running automatically. Confirm `prisma/generated/prisma/client` now exports a `ItemUnit` delegate: `grep -c "ItemUnit" prisma/generated/prisma/client/index.d.ts` should print a nonzero number.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: passes (no compile errors — nothing references the new fields yet, so this just confirms the schema/client change alone is clean).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "$(cat <<'EOF'
feat(schema): add ItemUnit conversion table and base_quantity columns

Lets an item be purchased/consumed in a unit other than its base unit
(Item.unit), with a per-item factor_to_base to convert. PurchaseItem
and Consumption keep their raw entered quantity/unit and gain a
snapshotted base_quantity for StockLedger/avg-cost.
EOF
)"
```

---

## Task 2: `toBaseQuantity` conversion helper

**Files:**
- Create: `src/lib/unit-conversion.ts`
- Test: `src/lib/unit-conversion.test.ts`

**Interfaces:**
- Consumes: `prisma.item`, `prisma.itemUnit` (Task 1).
- Produces: `toBaseQuantity(tx: Prisma.TransactionClient, item_id: string, unit: string, quantity: Prisma.Decimal | number): Promise<Prisma.Decimal>` — Tasks 4 and 5 both call this.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/unit-conversion.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { toBaseQuantity } from "./unit-conversion";
import { AppError } from "@lib/app-error";

let itemId: string;

describe("toBaseQuantity", () => {
    beforeAll(async () => {
        const item = await prisma.item.create({
            data: {
                name: `Unit Conversion Test ${crypto.randomUUID()}`,
                normalized_key: `unit conversion test ${crypto.randomUUID()}`,
                category: "FEED",
                unit: "KG",
            },
        });
        itemId = item.id;
        await prisma.itemUnit.create({
            data: { item_id: itemId, unit: "BAG", factor_to_base: 50 },
        });
    });

    afterAll(async () => {
        await prisma.itemUnit.deleteMany({ where: { item_id: itemId } });
        await prisma.item.delete({ where: { id: itemId } });
    });

    test("returns the quantity unchanged when unit already is the base unit", async () => {
        const result = await toBaseQuantity(prisma, itemId, "KG", 12.5);
        expect(result.toNumber()).toBe(12.5);
    });

    test("multiplies by factor_to_base when a conversion row exists", async () => {
        const result = await toBaseQuantity(prisma, itemId, "BAG", 3);
        expect(result.toNumber()).toBe(150);
    });

    test("throws bad-request when no conversion row exists for that unit", async () => {
        await expect(toBaseQuantity(prisma, itemId, "LITER", 1)).rejects.toMatchObject({
            status: 400,
        });
    });

    test("throws bad-request for a nonexistent item_id", async () => {
        await expect(
            toBaseQuantity(prisma, "00000000-0000-0000-0000-000000000000", "KG", 1),
        ).rejects.toBeInstanceOf(AppError);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/unit-conversion.test.ts`
Expected: FAIL — `Cannot find module './unit-conversion'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/unit-conversion.ts
import { Prisma } from "../../prisma/generated/prisma/client";
import { AppError } from "@lib/app-error";

/**
 * Converts a quantity entered in `unit` to the item's base unit (Item.unit),
 * using that item's ItemUnit conversion factor. Returns the quantity
 * unchanged when `unit` already is the base unit -- no factor row needed
 * for that case.
 */
export async function toBaseQuantity(
    tx: Prisma.TransactionClient,
    item_id: string,
    unit: string,
    quantity: Prisma.Decimal | number,
): Promise<Prisma.Decimal> {
    const item = await tx.item.findUnique({ where: { id: item_id }, select: { unit: true } });
    if (!item) throw AppError.badRequest("item_id does not reference an existing record");

    const qty = new Prisma.Decimal(quantity);
    if (unit === item.unit) return qty;

    const conversion = await tx.itemUnit.findUnique({
        where: { item_id_unit: { item_id, unit } },
    });
    if (!conversion) {
        throw AppError.badRequest(
            `No conversion factor from "${unit}" to this item's base unit "${item.unit}" -- add one via POST /item-units first`,
        );
    }
    return qty.times(conversion.factor_to_base);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/unit-conversion.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/unit-conversion.ts src/lib/unit-conversion.test.ts
git commit -m "$(cat <<'EOF'
feat(lib): add toBaseQuantity unit conversion helper

Shared by PurchaseService and ConsumptionService to resolve any
entered (item_id, unit, quantity) to the item's base unit before it
reaches StockLedger or StockUnit depletion math.
EOF
)"
```

---

## Task 3: `ItemUnit` CRUD (create/delete a conversion factor)

**Files:**
- Modify: `src/validators/item.validator.ts`
- Modify: `src/services/item.service.ts`
- Modify: `src/controllers/item.controller.ts`
- Modify: `src/routes/item.routes.ts`
- Modify: `src/routes/index.ts`
- Test: `src/services/item-unit.service.test.ts`

**Interfaces:**
- Consumes: nothing new beyond Task 1's schema.
- Produces: `POST /item-units` and `DELETE /item-units/:id`; `ItemUnitService.create`/`ItemUnitService.remove`; `ItemService`'s `getById`/`create`/`update`/`setActive` responses now include an `itemUnits` array. Task 4/5 don't call this service directly (they call `toBaseQuantity`), but their tests need this endpoint's underlying table populated the same way a real user would via `prisma.itemUnit.create` — this task's job is just making that a real, validated API, not a dependency of Tasks 4/5's code.

- [ ] **Step 1: Add the validator**

In `src/validators/item.validator.ts`, add after `updateItemSchema`:

```typescript
export const createItemUnitSchema = z.object({
    item_id: z.string().uuid(),
    unit: unitSchema,
    factor_to_base: z.coerce.number().positive("factor_to_base must be positive"),
});

export type CreateItemUnitInput = z.infer<typeof createItemUnitSchema>;
```

- [ ] **Step 2: Write the failing test**

```typescript
// src/services/item-unit.service.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { ItemUnitService } from "./item.service";
import { AppError } from "@lib/app-error";

let itemId: string;
const createdItemUnitIds: string[] = [];

describe("ItemUnitService", () => {
    beforeAll(async () => {
        const item = await prisma.item.create({
            data: {
                name: `Item Unit Test ${crypto.randomUUID()}`,
                normalized_key: `item unit test ${crypto.randomUUID()}`,
                category: "FEED",
                unit: "KG",
            },
        });
        itemId = item.id;
    });

    afterAll(async () => {
        await prisma.itemUnit.deleteMany({ where: { id: { in: createdItemUnitIds } } });
        await prisma.item.delete({ where: { id: itemId } });
    });

    test("create stores the conversion factor", async () => {
        const itemUnit = await ItemUnitService.create({
            item_id: itemId,
            unit: "BAG",
            factor_to_base: 50,
        });
        createdItemUnitIds.push(itemUnit!.id);
        expect(itemUnit!.factor_to_base.toNumber()).toBe(50);
        expect(itemUnit!.item_id).toBe(itemId);
    });

    test("create with a duplicate item_id+unit throws conflict", async () => {
        const itemUnit = await ItemUnitService.create({
            item_id: itemId,
            unit: "LITER",
            factor_to_base: 20,
        });
        createdItemUnitIds.push(itemUnit!.id);

        await expect(
            ItemUnitService.create({ item_id: itemId, unit: "LITER", factor_to_base: 25 }),
        ).rejects.toMatchObject({ status: 409 });
    });

    test("create with a nonexistent item_id throws bad-request", async () => {
        await expect(
            ItemUnitService.create({
                item_id: "00000000-0000-0000-0000-000000000000",
                unit: "BAG",
                factor_to_base: 50,
            }),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("remove deletes the row; removing an unknown id throws not-found", async () => {
        const itemUnit = await ItemUnitService.create({
            item_id: itemId,
            unit: "BOX",
            factor_to_base: 12,
        });

        await ItemUnitService.remove(itemUnit!.id);
        const found = await prisma.itemUnit.findUnique({ where: { id: itemUnit!.id } });
        expect(found).toBeNull();

        await expect(ItemUnitService.remove(itemUnit!.id)).rejects.toBeInstanceOf(AppError);
    });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test src/services/item-unit.service.test.ts`
Expected: FAIL — `ItemUnitService` is not exported from `./item.service`.

- [ ] **Step 4: Add the service**

In `src/services/item.service.ts`, add the import and a new export at the bottom of the file:

```typescript
import type {
    CreateItemInput,
    UpdateItemInput,
    ListItemsQuery,
    CreateItemUnitInput,
} from "@validators/item.validator";
```

```typescript
export const ItemUnitService = {
    async create(data: CreateItemUnitInput) {
        try {
            return await prisma.itemUnit.create({ data, include: { item: true } });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    async remove(id: string) {
        const link = await prisma.itemUnit.findUnique({ where: { id } });
        if (!link) throw AppError.notFound("ItemUnit conversion");
        await prisma.itemUnit.delete({ where: { id } });
    },
};
```

Also update the shared `include` const near the top of the file so `Item` reads (`getById`, `create`, `update`, `setActive`) return each item's conversions:

```typescript
const include = { suppliers: true, itemUnits: true } as const;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/services/item-unit.service.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 6: Add the controller**

In `src/controllers/item.controller.ts`, add the import and a new export at the bottom:

```typescript
import type {
    CreateItemInput,
    UpdateItemInput,
    ListItemsQuery,
    CreateItemUnitInput,
} from "@validators/item.validator";
import { ItemService, ItemUnitService } from "@services/item.service";
```

```typescript
export const ItemUnitController = {
    async create(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<CreateItemUnitInput>(c, "json");
            const itemUnit = await ItemUnitService.create(body);
            return sendSuccess(c, itemUnit, "Item unit conversion created", 201);
        });
    },

    async remove(c: Context) {
        return withHandler(c, async () => {
            await ItemUnitService.remove(c.req.param("id") ?? "");
            return sendSuccess(c, null, "Item unit conversion deleted");
        });
    },
};
```

- [ ] **Step 7: Add the routes**

In `src/routes/item.routes.ts`, add the import and a new exported router at the bottom:

```typescript
import { ItemController, ItemUnitController } from "@controllers/item.controller";
import {
    createItemSchema,
    updateItemSchema,
    listItemsQuerySchema,
    createItemUnitSchema,
} from "@validators/item.validator";
```

```typescript
export const itemUnitRoutes = new Hono();

itemUnitRoutes.post(
    "/",
    zValidatorRfc7807("json", createItemUnitSchema),
    ItemUnitController.create,
);
itemUnitRoutes.delete("/:id", ItemUnitController.remove);
```

- [ ] **Step 8: Mount the new router**

In `src/routes/index.ts`:

```typescript
import { itemRoutes, itemUnitRoutes } from "@routes/item.routes";
```

```typescript
appRoutes.route("/items", itemRoutes);
appRoutes.route("/item-units", itemUnitRoutes);
```

- [ ] **Step 9: Typecheck and run the full item test suite**

Run: `bun run typecheck && bun test src/services/item.service.test.ts src/services/item-unit.service.test.ts`
Expected: both pass.

- [ ] **Step 10: Commit**

```bash
git add src/validators/item.validator.ts src/services/item.service.ts src/controllers/item.controller.ts src/routes/item.routes.ts src/routes/index.ts src/services/item-unit.service.test.ts
git commit -m "$(cat <<'EOF'
feat(items): add ItemUnit conversion CRUD (POST/DELETE /item-units)

Lets an item register alternate units with a factor back to its base
unit (e.g. Feed: BAG = 50 KG). Item reads now include their itemUnits.
EOF
)"
```

---

## Task 4: Wire `PurchaseService.create` through `toBaseQuantity`, write `StockLedger` IN entries

**Files:**
- Modify: `src/services/purchase.service.ts`
- Modify: `src/services/purchase.service.test.ts`

**Interfaces:**
- Consumes: `toBaseQuantity` (Task 2), `StockLedgerService.record` (existing, `src/services/stock-ledger.service.ts`).
- Produces: every `PurchaseItem` now has a correct `base_quantity`; every purchase now posts a `StockLedger` `IN`/`PURCHASE` entry per line (closing the pre-existing gap where purchases never moved stock balance).

- [ ] **Step 1: Write the failing tests**

Add to `src/services/purchase.service.test.ts`, inside the `describe("PurchaseService", ...)` block, after the last existing test:

```typescript
    test("converts a purchased quantity to the item's base unit and posts a StockLedger IN entry", async () => {
        const kgItem = await prisma.item.create({
            data: {
                name: `Purchase Conversion Item ${crypto.randomUUID()}`,
                normalized_key: `purchase conversion item ${crypto.randomUUID()}`,
                category: "FEED",
                unit: "KG",
            },
        });
        const itemUnit = await prisma.itemUnit.create({
            data: { item_id: kgItem.id, unit: "BAG", factor_to_base: 50 },
        });

        const purchase = await PurchaseService.create({
            purchase_date: new Date(),
            paid_amount: 0,
            recorded_by_id: profileId,
            items: [{ item_id: kgItem.id, quantity: 2, unit: "BAG", unit_price: 1000 }],
        });
        createdPurchaseIds.push(purchase!.id);

        const purchaseItem = purchase!.items[0]!;
        expect(purchaseItem.quantity.toNumber()).toBe(2);
        expect(purchaseItem.unit).toBe("BAG");
        expect(purchaseItem.base_quantity.toNumber()).toBe(100);

        const ledgerEntry = await prisma.stockLedger.findFirst({
            where: { ref_type: "PURCHASE", ref_id: purchaseItem.id },
        });
        expect(ledgerEntry?.direction).toBe("IN");
        expect(ledgerEntry?.reason).toBe("PURCHASE");
        expect(ledgerEntry?.quantity.toNumber()).toBe(100);

        await prisma.itemUnit.delete({ where: { id: itemUnit.id } });
        await prisma.item.delete({ where: { id: kgItem.id } });
    });

    test("purchasing in a unit with no ItemUnit conversion row throws bad-request", async () => {
        const kgItem = await prisma.item.create({
            data: {
                name: `Purchase No Conversion Item ${crypto.randomUUID()}`,
                normalized_key: `purchase no conversion item ${crypto.randomUUID()}`,
                category: "FEED",
                unit: "KG",
            },
        });

        await expect(
            PurchaseService.create({
                purchase_date: new Date(),
                paid_amount: 0,
                recorded_by_id: profileId,
                items: [{ item_id: kgItem.id, quantity: 1, unit: "BAG", unit_price: 1000 }],
            }),
        ).rejects.toMatchObject({ status: 400 });

        await prisma.item.delete({ where: { id: kgItem.id } });
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/services/purchase.service.test.ts`
Expected: FAIL — `purchaseItem.base_quantity` is `undefined` (`toNumber` doesn't exist on `undefined`) on the first new test; the second new test fails because no ledger/conversion check exists yet, so the create actually succeeds instead of rejecting.

- [ ] **Step 3: Implement**

Replace the imports and `create` method in `src/services/purchase.service.ts`:

```typescript
import prisma from "@lib/db";
import { Prisma } from "../../prisma/generated/prisma/client";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import { toBaseQuantity } from "@lib/unit-conversion";
import { StockLedgerService } from "@services/stock-ledger.service";
import type {
    CreatePurchaseInput,
    ListPurchasesQuery,
    ListPurchaseItemsQuery,
} from "@validators/purchase.validator";
```

```typescript
    async create(data: CreatePurchaseInput) {
        const itemsWithTotals = data.items.map((item) => ({
            ...item,
            total_price: new Prisma.Decimal(item.quantity).times(item.unit_price),
        }));
        const total_amount = itemsWithTotals.reduce(
            (sum, item) => sum.plus(item.total_price),
            new Prisma.Decimal(0),
        );
        const paid_amount = new Prisma.Decimal(data.paid_amount);
        const due_amount = total_amount.minus(paid_amount);
        if (due_amount.isNegative()) {
            throw AppError.badRequest("paid_amount cannot exceed the purchase total");
        }

        try {
            return await prisma.$transaction(async (tx) => {
                const purchase = await tx.purchase.create({
                    data: {
                        purchase_date: data.purchase_date,
                        total_amount,
                        paid_amount,
                        due_amount,
                        recorded_by_id: data.recorded_by_id,
                        ...(data.supplier_id !== undefined && { supplier_id: data.supplier_id }),
                        ...(data.invoice_no !== undefined && { invoice_no: data.invoice_no }),
                    },
                });

                for (const item of itemsWithTotals) {
                    const base_quantity = await toBaseQuantity(
                        tx,
                        item.item_id,
                        item.unit,
                        item.quantity,
                    );
                    const purchaseItem = await tx.purchaseItem.create({
                        data: {
                            purchase_id: purchase.id,
                            item_id: item.item_id,
                            quantity: item.quantity,
                            unit: item.unit,
                            base_quantity,
                            unit_price: item.unit_price,
                            total_price: item.total_price,
                            ...(item.batch_id !== undefined && { batch_id: item.batch_id }),
                            ...(item.mfg_date !== undefined && { mfg_date: item.mfg_date }),
                            ...(item.expiration_date !== undefined && {
                                expiration_date: item.expiration_date,
                            }),
                        },
                    });
                    await StockLedgerService.record(tx, {
                        item_id: item.item_id,
                        quantity: base_quantity,
                        direction: "IN",
                        reason: "PURCHASE",
                        ref_type: "PURCHASE",
                        ref_id: purchaseItem.id,
                    });
                }

                return tx.purchase.findUniqueOrThrow({ where: { id: purchase.id }, include });
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/services/purchase.service.test.ts`
Expected: PASS, all tests (existing tests are unaffected — every existing call uses `unit: "BOTTLE"`, which already equals that item's base unit, so `toBaseQuantity` returns the quantity unchanged).

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add src/services/purchase.service.ts src/services/purchase.service.test.ts
git commit -m "$(cat <<'EOF'
feat(purchase): convert entered quantity to base unit, post StockLedger IN

Closes the pre-existing gap where purchases never moved stock
balance -- each PurchaseItem now snapshots base_quantity and posts a
matching StockLedger IN/PURCHASE entry inside the same transaction.
EOF
)"
```

---

## Task 5: Wire `ConsumptionService.create` through `toBaseQuantity`

**Files:**
- Modify: `src/validators/consumption.validator.ts`
- Modify: `src/services/consumption.service.ts`
- Modify: `src/services/consumption.service.test.ts`

**Interfaces:**
- Consumes: `toBaseQuantity` (Task 2).
- Produces: `Consumption.unit` is now a required input field; `StockUnit.remaining_quantity` depletion and the `StockLedger` OUT write both use the converted `base_quantity`, not the raw entered `quantity`.

- [ ] **Step 1: Add `unit` to the validator**

In `src/validators/consumption.validator.ts`:

```typescript
import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";
import { unitSchema } from "@lib/enums";

export const createConsumptionSchema = z.object({
    batch_id: z.string().uuid().optional(),
    house_id: z.string().uuid(),
    item_id: z.string().uuid(),
    // Set for medicine/vaccine/equipment draws from a specific coded unit;
    // omitted for aggregate items (feed) -- see ConsumptionService for the
    // branch this drives.
    stock_unit_id: z.string().uuid().optional(),
    quantity: z.coerce.number().positive("Quantity must be positive"),
    unit: unitSchema,
    date: z.coerce.date(),
    note: z.string().optional(),
    recorded_by_id: z.string().uuid(),
    idempotency_key: z.string().min(1).optional(),
});
```

- [ ] **Step 2: Update the existing tests to pass `unit`**

In `src/services/consumption.service.test.ts`, every `ConsumptionService.create({...})` call needs a `unit` field added matching that call's `item_id`: `feedItemId` was created with `unit: "BAG"` (see `beforeAll`), `medicineItemId` with `unit: "BOTTLE"`. Update all six calls:

- Line ~86-92 (`"aggregate draw..."`, uses `feedItemId`): add `unit: "BAG",` after `quantity: 25,`
- Line ~110-117 (`"coded draw decrements..."`, uses `medicineItemId`): add `unit: "BOTTLE",` after `quantity: 30,`
- Line ~139-146 (`"coded draw that exactly empties..."`, uses `medicineItemId`): add `unit: "BOTTLE",` after `quantity: 10,`
- Line ~163-170 (`"coded draw exceeding remaining_quantity..."`, uses `medicineItemId`): add `unit: "BOTTLE",` after `quantity: 50,`
- Line ~184-191 (`"drawing from a DISPOSED unit..."`, uses `medicineItemId`): add `unit: "BOTTLE",` after `quantity: 1,`
- Line ~196-202 (`"getAll includes..."`, uses `feedItemId`): add `unit: "BAG",` after `quantity: 5,`

- [ ] **Step 3: Write the failing conversion tests**

Add to `src/services/consumption.service.test.ts`, inside the `describe("ConsumptionService", ...)` block, after the last existing test. These need two dedicated items (base units `KG` and `ML`) plus their conversion factors, created and torn down within the tests themselves:

```typescript
    test("aggregate draw entered in a non-base unit converts before hitting StockLedger", async () => {
        const kgItem = await prisma.item.create({
            data: {
                name: `Consumption Conversion Item ${crypto.randomUUID()}`,
                normalized_key: `consumption conversion item ${crypto.randomUUID()}`,
                category: "FEED",
                unit: "KG",
            },
        });
        const itemUnit = await prisma.itemUnit.create({
            data: { item_id: kgItem.id, unit: "BAG", factor_to_base: 50 },
        });

        const consumption = await ConsumptionService.create({
            house_id: houseId,
            item_id: kgItem.id,
            quantity: 2,
            unit: "BAG",
            date: new Date(),
            recorded_by_id: profileId,
        });

        expect(consumption!.quantity.toNumber()).toBe(2);
        expect(consumption!.unit).toBe("BAG");
        expect(consumption!.base_quantity.toNumber()).toBe(100);

        const ledgerEntry = await prisma.stockLedger.findFirst({
            where: { ref_type: "CONSUMPTION", ref_id: consumption!.id },
        });
        expect(ledgerEntry?.quantity.toNumber()).toBe(100);

        await prisma.consumption.delete({ where: { id: consumption!.id } });
        await prisma.stockLedger.deleteMany({ where: { item_id: kgItem.id } });
        await prisma.itemUnit.delete({ where: { id: itemUnit.id } });
        await prisma.item.delete({ where: { id: kgItem.id } });
    });

    test("coded draw entered in a non-base unit converts before depleting StockUnit.remaining_quantity", async () => {
        const mlItem = await prisma.item.create({
            data: {
                name: `Consumption Coded Conversion Item ${crypto.randomUUID()}`,
                normalized_key: `consumption coded conversion item ${crypto.randomUUID()}`,
                category: "MEDICINE",
                unit: "ML",
            },
        });
        const itemUnit = await prisma.itemUnit.create({
            data: { item_id: mlItem.id, unit: "L", factor_to_base: 1000 },
        });
        const mlPurchase = await prisma.purchase.create({
            data: {
                purchase_date: new Date(),
                total_amount: 0,
                paid_amount: 0,
                due_amount: 0,
                recorded_by_id: profileId,
            },
        });
        const mlPurchaseItem = await prisma.purchaseItem.create({
            data: {
                purchase_id: mlPurchase.id,
                item_id: mlItem.id,
                quantity: 1,
                unit: "L",
                base_quantity: 1000,
                unit_price: 300,
                total_price: 300,
            },
        });

        const [unit] = await StockUnitService.provision(1);
        await StockUnitService.bind(unit!.id, {
            purchase_item_id: mlPurchaseItem.id,
            initial_quantity: 3000, // a 3L bottle, in mL (base unit)
        });

        const consumption = await ConsumptionService.create({
            house_id: houseId,
            item_id: mlItem.id,
            stock_unit_id: unit!.id,
            quantity: 0.5,
            unit: "L",
            date: new Date(),
            recorded_by_id: profileId,
        });

        const updatedUnit = await prisma.stockUnit.findUniqueOrThrow({ where: { id: unit!.id } });
        expect(updatedUnit.remaining_quantity?.toNumber()).toBe(2500);

        await prisma.consumption.delete({ where: { id: consumption!.id } });
        await prisma.stockUnit.delete({ where: { id: unit!.id } });
        await prisma.purchaseItem.delete({ where: { id: mlPurchaseItem.id } });
        await prisma.purchase.delete({ where: { id: mlPurchase.id } });
        await prisma.itemUnit.delete({ where: { id: itemUnit.id } });
        await prisma.item.delete({ where: { id: mlItem.id } });
    });
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `bun test src/services/consumption.service.test.ts`
Expected: FAIL — Zod rejects every existing call with a missing `unit` field (400), and the two new tests fail on `consumption!.base_quantity` being `undefined`.

- [ ] **Step 5: Implement**

Replace `src/services/consumption.service.ts` in full:

```typescript
import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import { toBaseQuantity } from "@lib/unit-conversion";
import { StockLedgerService } from "@services/stock-ledger.service";
import type {
    CreateConsumptionInput,
    ListConsumptionsQuery,
} from "@validators/consumption.validator";

export const ConsumptionService = {
    async getAll(query: ListConsumptionsQuery) {
        const where = {
            ...(query.batch_id !== undefined && { batch_id: query.batch_id }),
            ...(query.house_id !== undefined && { house_id: query.house_id }),
            ...(query.item_id !== undefined && { item_id: query.item_id }),
            ...((query.occurred_from !== undefined || query.occurred_to !== undefined) && {
                date: {
                    ...(query.occurred_from !== undefined && { gte: query.occurred_from }),
                    ...(query.occurred_to !== undefined && { lte: query.occurred_to }),
                },
            }),
        };
        const [consumptions, total] = await Promise.all([
            prisma.consumption.findMany({
                where,
                include: { batch: true, house: true, item: true, stock_unit: true },
                orderBy: { date: "desc" },
                ...toSkipTake(query),
            }),
            prisma.consumption.count({ where }),
        ]);
        return { consumptions, meta: buildMeta(total, query) };
    },

    /** Two draw paths, branching on stock_unit_id:
     *  - coded (medicine/vaccine/equipment): decrements StockUnit.remaining_quantity,
     *    flips status IN_STOCK -> IN_USE, or -> CONSUMED once it hits zero.
     *    Equipment (remaining_quantity null) just flips to IN_USE once, non-depleting.
     *  - aggregate (feed etc.): no StockUnit -- writes a StockLedger OUT entry instead.
     *  Both paths use base_quantity (data.quantity converted to Item.unit via
     *  toBaseQuantity), never the raw entered quantity -- StockUnit.remaining_quantity
     *  and StockLedger are always in the item's base unit. */
    async create(data: CreateConsumptionInput) {
        try {
            return await prisma.$transaction(async (tx) => {
                const base_quantity = await toBaseQuantity(tx, data.item_id, data.unit, data.quantity);

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

                const consumption = await tx.consumption.create({
                    data: {
                        house_id: data.house_id,
                        item_id: data.item_id,
                        quantity: data.quantity,
                        unit: data.unit,
                        base_quantity,
                        date: data.date,
                        recorded_by_id: data.recorded_by_id,
                        idempotency_key: data.idempotency_key ?? crypto.randomUUID(),
                        ...(data.batch_id !== undefined && { batch_id: data.batch_id }),
                        ...(data.stock_unit_id !== undefined && {
                            stock_unit_id: data.stock_unit_id,
                        }),
                        ...(data.note !== undefined && { note: data.note }),
                    },
                });

                if (data.stock_unit_id === undefined) {
                    await StockLedgerService.record(tx, {
                        item_id: data.item_id,
                        quantity: base_quantity,
                        direction: "OUT",
                        reason: "CONSUMPTION",
                        ref_type: "CONSUMPTION",
                        ref_id: consumption.id,
                    });
                }

                return consumption;
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },
};
```

(Note: the `Prisma` import is dropped -- `new Prisma.Decimal(data.quantity)` is no longer needed since `toBaseQuantity` already returns a `Prisma.Decimal`.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test src/services/consumption.service.test.ts`
Expected: PASS, all tests (existing + 2 new).

- [ ] **Step 7: Typecheck**

Run: `bun run typecheck`
Expected: passes.

- [ ] **Step 8: Commit**

```bash
git add src/validators/consumption.validator.ts src/services/consumption.service.ts src/services/consumption.service.test.ts
git commit -m "$(cat <<'EOF'
feat(consumption): require entry unit, convert to base before ledger/depletion

Consumption.unit is now required input. Both the coded-draw
(StockUnit.remaining_quantity) and aggregate-draw (StockLedger OUT)
paths use base_quantity, so a dose logged in mL against a bottle
purchased in Liters depletes correctly.
EOF
)"
```

---

## Task 6: Fix `getItemAvgCosts` to normalize by `base_quantity`

**Files:**
- Modify: `src/lib/stock-value.ts`
- Test: `src/lib/stock-value.test.ts`

**Interfaces:**
- Consumes: `PurchaseItem.base_quantity` (Task 1).
- Produces: `getItemAvgCosts` (existing signature, unchanged) now returns a correct cost-per-base-unit even when an item was purchased under different units across multiple lines.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/stock-value.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { getItemAvgCosts } from "./stock-value";

let itemId: string;
let purchaseId: string;
let profileId: string;
const purchaseItemIds: string[] = [];

describe("getItemAvgCosts", () => {
    beforeAll(async () => {
        const item = await prisma.item.create({
            data: {
                name: `Avg Cost Test ${crypto.randomUUID()}`,
                normalized_key: `avg cost test ${crypto.randomUUID()}`,
                category: "FEED",
                unit: "KG",
            },
        });
        itemId = item.id;

        const profile = await prisma.profiles.create({
            data: {
                name: "Avg Cost Recorder",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "ADMIN",
            },
        });
        profileId = profile.id;

        const purchase = await prisma.purchase.create({
            data: {
                purchase_date: new Date(),
                total_amount: 1150,
                paid_amount: 1150,
                due_amount: 0,
                recorded_by_id: profileId,
            },
        });
        purchaseId = purchase.id;

        // 1 BAG @ 50kg, total 1000 -> 20/kg
        const bagLine = await prisma.purchaseItem.create({
            data: {
                purchase_id: purchaseId,
                item_id: itemId,
                quantity: 1,
                unit: "BAG",
                base_quantity: 50,
                unit_price: 1000,
                total_price: 1000,
            },
        });
        // 10 KG @ 15/kg, total 150
        const kgLine = await prisma.purchaseItem.create({
            data: {
                purchase_id: purchaseId,
                item_id: itemId,
                quantity: 10,
                unit: "KG",
                base_quantity: 10,
                unit_price: 15,
                total_price: 150,
            },
        });
        purchaseItemIds.push(bagLine.id, kgLine.id);
    });

    afterAll(async () => {
        await prisma.purchaseItem.deleteMany({ where: { id: { in: purchaseItemIds } } });
        await prisma.purchase.delete({ where: { id: purchaseId } });
        await prisma.item.delete({ where: { id: itemId } });
        await prisma.profiles.delete({ where: { id: profileId } });
    });

    test("averages cost per base unit across purchases entered in different units", async () => {
        const costs = await getItemAvgCosts([itemId]);
        // (1000 + 150) / (50 + 10) = 1150 / 60 = 19.1666...
        expect(costs.get(itemId)?.toNumber()).toBeCloseTo(19.1667, 3);
    });

    test("an item never purchased is absent from the map", async () => {
        const costs = await getItemAvgCosts(["00000000-0000-0000-0000-000000000000"]);
        expect(costs.has("00000000-0000-0000-0000-000000000000")).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/stock-value.test.ts`
Expected: FAIL — with the current `_sum: { quantity: true }`, the sum is `1 + 10 = 11`, so the computed average is `1150 / 11 ≈ 104.5`, not `≈19.1667`.

- [ ] **Step 3: Implement**

Replace `src/lib/stock-value.ts` in full:

```typescript
import prisma from "@lib/db";
import { Prisma } from "../../prisma/generated/prisma/client";

/**
 * Weighted-average cost per base unit, derived from purchase history --
 * StockLedger.unit_cost is never populated by any write path (see
 * consumption.service.ts / inventory-adjustment.service.ts), so PurchaseItem
 * is the only real cost basis in this system. sum(total_price)/sum(base_quantity)
 * across every purchase line for that item -- base_quantity (not the raw
 * entered quantity) so a mix of units across purchases (e.g. one line in BAG,
 * another in KG) still averages correctly. Items never purchased are absent
 * from the map -- callers must treat missing as "unknown cost", not zero.
 */
export async function getItemAvgCosts(itemIds: string[]): Promise<Map<string, Prisma.Decimal>> {
    if (itemIds.length === 0) return new Map();
    const grouped = await prisma.purchaseItem.groupBy({
        by: ["item_id"],
        where: { item_id: { in: itemIds } },
        _sum: { base_quantity: true, total_price: true },
    });

    const costs = new Map<string, Prisma.Decimal>();
    for (const row of grouped) {
        const quantity = row._sum.base_quantity ?? new Prisma.Decimal(0);
        const totalPrice = row._sum.total_price ?? new Prisma.Decimal(0);
        if (quantity.isZero()) continue;
        costs.set(row.item_id, totalPrice.div(quantity));
    }
    return costs;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/stock-value.test.ts`
Expected: PASS, both tests.

- [ ] **Step 5: Typecheck and run the full test suite**

Run: `bun run typecheck && bun test`
Expected: everything passes — this is the integration check that Tasks 1-6 compose correctly.

- [ ] **Step 6: Commit**

```bash
git add src/lib/stock-value.ts src/lib/stock-value.test.ts
git commit -m "$(cat <<'EOF'
fix(stock-value): normalize avg cost by base_quantity, not raw quantity

getItemAvgCosts previously summed PurchaseItem.quantity directly, so
an item bought under mixed units (e.g. BAG then KG) produced a
silently wrong average. Sums base_quantity instead.
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** `ItemUnit` table (Task 1), bidirectional-capable factor storage (Task 1's schema — reporting-direction division is left to callers, per spec's "no schema field decides display unit"), `PurchaseItem.base_quantity` snapshot (Task 1, 4), `Consumption.unit`/`base_quantity` (Task 1, 5), validation rejecting unregistered units (Task 2's `toBaseQuantity`, used by both entry points), `getItemAvgCosts` fix (Task 6), purchase→StockLedger gap closed (Task 4). `StockUnit` is explicitly untouched, matching the spec's "unaffected" call.
- **Type consistency:** `toBaseQuantity`'s signature (Task 2) matches every call site in Tasks 4 and 5. `ItemUnitService.create`/`remove` (Task 3) match `ItemUnitController`'s calls exactly.
- **Out of scope carried forward:** historical/versioned factors, UI default-unit selection, and StockUnit changes are not tasks here, per the spec's explicit exclusions.
