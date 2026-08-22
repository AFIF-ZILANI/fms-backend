-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('FLAT', 'PERCENT');

-- AlterTable: global discount on the purchase as a whole
ALTER TABLE "Purchase" ADD COLUMN "discount_type" "DiscountType";
ALTER TABLE "Purchase" ADD COLUMN "discount_value" DECIMAL(10,2);

-- AlterTable: per-line discount
ALTER TABLE "PurchaseItem" ADD COLUMN "discount_type" "DiscountType";
ALTER TABLE "PurchaseItem" ADD COLUMN "discount_value" DECIMAL(10,2);
