-- DropIndex
DROP INDEX "Expense_cost_type_idx";

-- DropIndex
DROP INDEX "Profiles_role_idx";

-- DropIndex
DROP INDEX "StockTransfer_to_location_type_to_location_id_idx";

-- CreateIndex
CREATE INDEX "Consumption_item_id_date_idx" ON "Consumption"("item_id", "date");

-- CreateIndex
CREATE INDEX "Consumption_date_idx" ON "Consumption"("date");

-- CreateIndex
CREATE INDEX "Payment_from_instrument_id_idx" ON "Payment"("from_instrument_id");

-- CreateIndex
CREATE INDEX "Payment_to_instrument_id_idx" ON "Payment"("to_instrument_id");

-- CreateIndex
CREATE INDEX "PurchaseItem_purchase_id_idx" ON "PurchaseItem"("purchase_id");

-- CreateIndex
CREATE INDEX "StockLedger_location_type_location_id_item_id_idx" ON "StockLedger"("location_type", "location_id", "item_id");

-- CreateIndex
CREATE INDEX "StockLedger_occurred_at_idx" ON "StockLedger"("occurred_at");
