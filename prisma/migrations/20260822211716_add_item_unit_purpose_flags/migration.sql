-- AlterTable: purpose flags on ItemUnit -- which flows a purchase/consumption
-- conversion factor is valid for.
ALTER TABLE "ItemUnit" ADD COLUMN "is_purchasable" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ItemUnit" ADD COLUMN "is_usable" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: existing rows have always been valid for both purchase and
-- consumption (toBaseQuantity had no purpose filter before this migration) --
-- preserve that behavior for data written before the flags existed.
UPDATE "ItemUnit" SET "is_usable" = true;
