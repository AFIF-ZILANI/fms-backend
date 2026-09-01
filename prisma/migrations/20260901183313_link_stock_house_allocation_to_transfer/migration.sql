-- AlterTable
ALTER TABLE "StockHouseAllocation" ADD COLUMN     "stock_transfer_id" TEXT;

-- CreateIndex
CREATE INDEX "StockHouseAllocation_stock_transfer_id_idx" ON "StockHouseAllocation"("stock_transfer_id");

-- AddForeignKey
ALTER TABLE "StockHouseAllocation" ADD CONSTRAINT "StockHouseAllocation_stock_transfer_id_fkey" FOREIGN KEY ("stock_transfer_id") REFERENCES "StockTransfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
