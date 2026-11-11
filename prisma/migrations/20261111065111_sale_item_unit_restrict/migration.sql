-- DropForeignKey
ALTER TABLE "SaleItem" DROP CONSTRAINT "SaleItem_unit_fkey";

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_unit_fkey" FOREIGN KEY ("unit") REFERENCES "Unit"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
