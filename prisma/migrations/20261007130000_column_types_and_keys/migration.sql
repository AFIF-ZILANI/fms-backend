-- DES-16 / DES-19 / DES-20. Hand-written: Prisma drops and re-adds a column to turn text into an
-- enum, which would lose the data, so the conversions use explicit casts.

-- ── IngestedSale: the two text columns the code branches on become enums ──────────────────────────
CREATE TYPE "IngestStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DISMISSED');
CREATE TYPE "IngestPortion" AS ENUM ('main', 'cull');
ALTER TABLE "IngestedSale"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "IngestStatus" USING "status"::"IngestStatus",
  ALTER COLUMN "status" SET DEFAULT 'PENDING',
  ALTER COLUMN "portion" TYPE "IngestPortion" USING "portion"::"IngestPortion";

-- ── Alerts: @db.Date threw away the time the code writes; widen to a timestamp (lossless) ─────────
ALTER TABLE "Alerts"
  ALTER COLUMN "issued_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "resolved_at" SET DATA TYPE TIMESTAMP(3);

-- ── StockLedger.unit_cost: a per-dose or per-gram cost rounds to nothing at 2 places (lossless) ───
ALTER TABLE "StockLedger" ALTER COLUMN "unit_cost" SET DATA TYPE DECIMAL(14,4);

-- ── Houses: a number is unique within a type (Brooder 1 and Grower 1 coexist on this farm) ────────
DROP INDEX "Houses_type_idx";
CREATE UNIQUE INDEX "Houses_type_number_key" ON "Houses"("type", "number");

-- ── Purchase.warehouse_id becomes required ────────────────────────────────────────────────────────
-- Purchases written before the warehouse was mandatory (two, both fixtures) go to the oldest warehouse,
-- the farm's main one, and their stock-ledger rows get the same tag so the balance lands somewhere.
UPDATE "Purchase" SET "warehouse_id" = (SELECT "id" FROM "Warehouses" ORDER BY "created_at", "id" LIMIT 1)
WHERE "warehouse_id" IS NULL;
UPDATE "StockLedger" l SET "location_type" = 'WAREHOUSE', "location_id" = p."warehouse_id"
FROM "PurchaseItem" pi JOIN "Purchase" p ON p."id" = pi."purchase_id"
WHERE l."ref_type" = 'PURCHASE' AND l."ref_id" = pi."id" AND l."location_id" IS NULL;

ALTER TABLE "Purchase" DROP CONSTRAINT "Purchase_warehouse_id_fkey";
ALTER TABLE "Purchase" ALTER COLUMN "warehouse_id" SET NOT NULL;
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "Warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Expense: a DIRECT cost is attributed to a batch ───────────────────────────────────────────────
-- NOT VALID: two older DIRECT expenses ("TRANSPORT", 4,000 and 1,000) were recorded with no batch.
-- They are left as they are -- reclassifying money is the owner's call -- and every new or changed row
-- is checked. Once they are attached to a batch or made SHARED_PERIOD:
--   ALTER TABLE "Expense" VALIDATE CONSTRAINT "Expense_direct_has_batch";
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_direct_has_batch"
  CHECK (cost_type <> 'DIRECT' OR batch_id IS NOT NULL) NOT VALID;
