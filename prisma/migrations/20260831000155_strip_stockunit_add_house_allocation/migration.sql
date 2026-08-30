-- DropForeignKey
ALTER TABLE "StockUnit" DROP CONSTRAINT "StockUnit_bound_by_id_fkey";

-- DropForeignKey
ALTER TABLE "StockUnit" DROP CONSTRAINT "StockUnit_house_id_fkey";

-- DropForeignKey
ALTER TABLE "Unit" DROP CONSTRAINT "Unit_base_unit_fkey";

-- DropIndex
DROP INDEX "StockUnit_code_key";

-- AlterTable
ALTER TABLE "StockUnit" DROP COLUMN "bound_by_id",
DROP COLUMN "code",
DROP COLUMN "house_id",
DROP COLUMN "initial_quantity",
DROP COLUMN "remaining_quantity";

-- CreateTable
CREATE TABLE "StockHouseAllocation" (
    "id" TEXT NOT NULL,
    "stock_unit_id" TEXT NOT NULL,
    "house_id" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotency_key" TEXT NOT NULL,

    CONSTRAINT "StockHouseAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockHouseAllocation_idempotency_key_key" ON "StockHouseAllocation"("idempotency_key");

-- CreateIndex
CREATE INDEX "StockHouseAllocation_stock_unit_id_idx" ON "StockHouseAllocation"("stock_unit_id");

-- CreateIndex
CREATE INDEX "StockHouseAllocation_house_id_occurred_at_idx" ON "StockHouseAllocation"("house_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_base_unit_fkey" FOREIGN KEY ("base_unit") REFERENCES "Unit"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockHouseAllocation" ADD CONSTRAINT "StockHouseAllocation_stock_unit_id_fkey" FOREIGN KEY ("stock_unit_id") REFERENCES "StockUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockHouseAllocation" ADD CONSTRAINT "StockHouseAllocation_house_id_fkey" FOREIGN KEY ("house_id") REFERENCES "Houses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

