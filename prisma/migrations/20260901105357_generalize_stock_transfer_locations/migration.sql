-- DropForeignKey
ALTER TABLE "StockTransfer" DROP CONSTRAINT "StockTransfer_from_warehouse_id_fkey";

-- DropForeignKey
ALTER TABLE "StockTransfer" DROP CONSTRAINT "StockTransfer_to_house_id_fkey";

-- DropIndex
DROP INDEX "StockTransfer_to_house_id_idx";

-- AlterTable: add the new generic endpoint columns, nullable for the backfill
ALTER TABLE "StockTransfer"
    ADD COLUMN "from_location_type" "LocationType",
    ADD COLUMN "from_location_id" TEXT,
    ADD COLUMN "to_location_type" "LocationType",
    ADD COLUMN "to_location_id" TEXT;

-- Backfill: every existing row was a warehouse->house transfer (the only shape this model
-- supported before this migration).
UPDATE "StockTransfer"
SET "from_location_type" = 'WAREHOUSE',
    "from_location_id" = "from_warehouse_id",
    "to_location_type" = 'HOUSE',
    "to_location_id" = "to_house_id";

ALTER TABLE "StockTransfer"
    ALTER COLUMN "from_location_type" SET NOT NULL,
    ALTER COLUMN "from_location_id" SET NOT NULL,
    ALTER COLUMN "to_location_type" SET NOT NULL,
    ALTER COLUMN "to_location_id" SET NOT NULL;

-- AlterTable: drop the old warehouse/house-specific columns
ALTER TABLE "StockTransfer"
    DROP COLUMN "from_warehouse_id",
    DROP COLUMN "to_house_id";

-- CreateIndex
CREATE INDEX "StockTransfer_to_location_type_to_location_id_idx" ON "StockTransfer"("to_location_type", "to_location_id");
