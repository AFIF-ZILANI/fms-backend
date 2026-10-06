-- Row invariants that lived only in service code. Prisma can't express a CHECK, so they live here.
-- Each predicate was run negated against the data first; every one held except the single legacy
-- score entry noted below.

-- At most one open payout account per employee (the service closes the old one and inserts the new
-- one in a transaction, but two concurrent creates could both do that and leave two open).
CREATE UNIQUE INDEX "EmployeePayoutAccount_one_active_key" ON "EmployeePayoutAccount"("employee_id") WHERE (active_to IS NULL);

-- A reference is an employee or an outsider, never both.
ALTER TABLE "Employees" ADD CONSTRAINT "Employees_reference_xor"
  CHECK (reference_employee_id IS NULL OR (reference_name IS NULL AND reference_phone IS NULL AND reference_address IS NULL));

-- A task's location is a house or a free-text note, never both.
ALTER TABLE "EmployeeTaskAssignment" ADD CONSTRAINT "EmployeeTaskAssignment_location_xor"
  CHECK (house_id IS NULL OR location_note IS NULL);

-- Score entries: an OTHER entry needs an approver; a voided entry needs its reason; an entry of -4 or
-- worse needs the written notice first. The notice rule is NOT VALID: one legacy entry (written before
-- the service enforced it) has none, so existing rows are not checked but every new or changed row is.
-- A voided entry is exempt -- it no longer counts against anyone, and voiding is how that legacy row
-- gets retired. Run `ALTER TABLE "PerformanceScoreEntry" VALIDATE CONSTRAINT "PSE_notice_required"`
-- once it has been voided or given its notice.
ALTER TABLE "PerformanceScoreEntry" ADD CONSTRAINT "PSE_other_approved"
  CHECK (criterion <> 'OTHER' OR approved_by_id IS NOT NULL);
ALTER TABLE "PerformanceScoreEntry" ADD CONSTRAINT "PSE_void_reason"
  CHECK (status <> 'VOIDED' OR void_reason IS NOT NULL);
ALTER TABLE "PerformanceScoreEntry" ADD CONSTRAINT "PSE_notice_required"
  CHECK (points > -4 OR notice_doc_url IS NOT NULL OR status = 'VOIDED') NOT VALID;

-- An adjustment records the delta it caused, at exactly one location.
ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_delta"
  CHECK (adjustment_quantity = quantity_after - quantity_before);
ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_one_location"
  CHECK (num_nonnulls(warehouse_id, house_id) = 1);

-- A bird sale's sex split adds up to the birds sold.
ALTER TABLE "BirdSale" ADD CONSTRAINT "BirdSale_sex_sum"
  CHECK (male_count IS NULL OR female_count IS NULL OR male_count + female_count = birds_count);

-- Money and quantities that move are positive: a zero or negative row is always a bug, and the
-- direction columns already say which way it goes.
ALTER TABLE "Payment"              ADD CONSTRAINT "Payment_amount_pos"      CHECK (amount > 0);
ALTER TABLE "Expense"              ADD CONSTRAINT "Expense_amount_pos"      CHECK (amount > 0);
ALTER TABLE "StockLedger"          ADD CONSTRAINT "StockLedger_qty_pos"     CHECK (quantity > 0);
ALTER TABLE "Consumption"          ADD CONSTRAINT "Consumption_qty_pos"     CHECK (quantity > 0);
ALTER TABLE "PurchaseItem"         ADD CONSTRAINT "PurchaseItem_qty_pos"    CHECK (quantity > 0);
ALTER TABLE "SaleItem"             ADD CONSTRAINT "SaleItem_qty_pos"        CHECK (quantity > 0);
ALTER TABLE "StockTransfer"        ADD CONSTRAINT "StockTransfer_qty_pos"   CHECK (quantity > 0);
ALTER TABLE "BatchHouseAllocation" ADD CONSTRAINT "BHA_qty_pos"             CHECK (quantity > 0);
ALTER TABLE "MortalityLog"         ADD CONSTRAINT "MortalityLog_count_pos"  CHECK (count_died > 0);
ALTER TABLE "BirdSale"             ADD CONSTRAINT "BirdSale_count_pos"      CHECK (birds_count > 0);
