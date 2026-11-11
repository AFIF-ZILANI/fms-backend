-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "discount_type" "DiscountType",
ADD COLUMN     "discount_value" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN     "discount_type" "DiscountType",
ADD COLUMN     "discount_value" DECIMAL(10,2);
