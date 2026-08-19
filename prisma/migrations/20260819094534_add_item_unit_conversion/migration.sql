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
-- Before running this against a DB with real purchase history predating this
-- feature, verify that assumption: SELECT pi.id FROM "PurchaseItem" pi JOIN "Item" i
-- ON i.id = pi.item_id WHERE pi.unit <> i.unit (and the equivalent join for
-- "Consumption") -- hand-correct any hits first. This project's dev DB was
-- already audited with this query and found clean.
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
