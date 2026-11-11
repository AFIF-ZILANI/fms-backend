-- CreateEnum
CREATE TYPE "SaleKind" AS ENUM ('CODED', 'STOCK', 'FARM_MADE');

-- AlterEnum
ALTER TYPE "StockUnitStatus" ADD VALUE 'SOLD';

-- DropForeignKey
ALTER TABLE "SaleItem" DROP CONSTRAINT "SaleItem_unit_fkey";

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "is_farm_made" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "kind" "SaleKind" NOT NULL DEFAULT 'STOCK',
ADD COLUMN     "warehouse_id" TEXT;

-- AlterTable
ALTER TABLE "SaleItem" ALTER COLUMN "unit" DROP NOT NULL;

-- AlterTable
ALTER TABLE "StockUnit" ADD COLUMN     "sale_item_id" TEXT,
ADD COLUMN     "sold_at" TIMESTAMP(3),
ADD COLUMN     "sold_by_id" TEXT;

-- CreateIndex
CREATE INDEX "StockUnit_sale_item_id_idx" ON "StockUnit"("sale_item_id");

-- AddForeignKey
ALTER TABLE "StockUnit" ADD CONSTRAINT "StockUnit_sale_item_id_fkey" FOREIGN KEY ("sale_item_id") REFERENCES "SaleItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockUnit" ADD CONSTRAINT "StockUnit_sold_by_id_fkey" FOREIGN KEY ("sold_by_id") REFERENCES "Profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "Warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_unit_fkey" FOREIGN KEY ("unit") REFERENCES "Unit"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- Litter and other WASTE items were the farm-made items before the flag existed.
UPDATE "Item" SET "is_farm_made" = true WHERE "category" = 'WASTE';

-- A farm-made item is never bought, so it can't be QR-tracked either.
ALTER TABLE "Item" ADD CONSTRAINT "Item_farm_made_not_tracked" CHECK (NOT ("is_farm_made" AND "is_unit_tracked"));
