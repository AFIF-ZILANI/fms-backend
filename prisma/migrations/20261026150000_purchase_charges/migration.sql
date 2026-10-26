-- Purchase charges (transport, labour) land into the purchase's stock cost. Additive only:
-- a new enum value, a nullable column, an index, a FK and two CHECKs -- no existing row changes.
ALTER TYPE "CostType" ADD VALUE 'STOCK';

ALTER TABLE "Expense" ADD COLUMN "purchase_id" TEXT;

CREATE INDEX "Expense_purchase_id_idx" ON "Expense"("purchase_id");

ALTER TABLE "Expense" ADD CONSTRAINT "Expense_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- cost_type::text, not the enum literal: a value added by ADD VALUE can't be used in the same transaction.
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_stock_is_purchase_charge"
  CHECK ((cost_type::text = 'STOCK') = (purchase_id IS NOT NULL));

-- A purchase charge is costed through the stock it came with, never directly onto a batch.
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_purchase_charge_no_batch"
  CHECK (purchase_id IS NULL OR batch_id IS NULL);
