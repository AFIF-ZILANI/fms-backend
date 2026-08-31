/*
  Warnings:

  - Added the required column `type` to the `StockHouseAllocation` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "AllocationType" AS ENUM ('ALLOCATION', 'REALLOCATION', 'RETURN');

-- DropForeignKey
ALTER TABLE "StockHouseAllocation" DROP CONSTRAINT "StockHouseAllocation_house_id_fkey";

-- AlterTable
ALTER TABLE "StockHouseAllocation" ADD COLUMN     "type" "AllocationType",
ALTER COLUMN "house_id" DROP NOT NULL;

-- Backfill: a unit's earliest allocation row is its ALLOCATION (warehouse -> house),
-- every later row for that unit is a REALLOCATION. No pre-existing row can be a RETURN --
-- that state didn't exist before this migration.
UPDATE "StockHouseAllocation" AS a
SET "type" = CASE WHEN ranked.rn = 1 THEN 'ALLOCATION' ELSE 'REALLOCATION' END::"AllocationType"
FROM (
    SELECT "id", ROW_NUMBER() OVER (PARTITION BY "stock_unit_id" ORDER BY "occurred_at") AS rn
    FROM "StockHouseAllocation"
) AS ranked
WHERE a."id" = ranked."id";

ALTER TABLE "StockHouseAllocation" ALTER COLUMN "type" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "StockHouseAllocation" ADD CONSTRAINT "StockHouseAllocation_house_id_fkey" FOREIGN KEY ("house_id") REFERENCES "Houses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
