-- Opening balances are gone. Production had none left (all converted to ordinary purchases on
-- 2026-11-01); any leftover rows elsewhere become a plain adjustment / an ordinary purchase.
UPDATE "StockLedger" SET "reason" = 'ADJUSTMENT' WHERE "reason" = 'OPENING_BALANCE';

ALTER TYPE "StockReason" RENAME TO "StockReason_old";
CREATE TYPE "StockReason" AS ENUM ('PURCHASE', 'TRANSFER', 'CONSUMPTION', 'SALE', 'WASTAGE', 'EXPIRED', 'ADJUSTMENT');
ALTER TABLE "StockLedger" ALTER COLUMN "reason" TYPE "StockReason" USING ("reason"::text::"StockReason");
DROP TYPE "StockReason_old";

ALTER TABLE "Purchase" DROP COLUMN "is_opening";
