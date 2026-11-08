-- Settlement window: a SOLD batch stays open this many days for late costs/income, then is finalised.
ALTER TABLE "FarmSettings" ADD COLUMN "settlement_days" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "FarmSettings" ADD CONSTRAINT "FarmSettings_settlement_days_range" CHECK ("settlement_days" BETWEEN 0 AND 60);

-- A sale (litter etc.) can belong to a batch's books.
ALTER TABLE "Sale" ADD COLUMN "batch_id" TEXT;
CREATE INDEX "Sale_batch_id_idx" ON "Sale"("batch_id");
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "Batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
