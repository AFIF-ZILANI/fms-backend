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
