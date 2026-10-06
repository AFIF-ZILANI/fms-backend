-- DropForeignKey
ALTER TABLE "Admins" DROP CONSTRAINT "Admins_profile_id_fkey";

-- DropForeignKey
ALTER TABLE "BatchHouseAllocation" DROP CONSTRAINT "BatchHouseAllocation_batch_id_fkey";

-- DropForeignKey
ALTER TABLE "BatchHouseAllocation" DROP CONSTRAINT "BatchHouseAllocation_from_house_id_fkey";

-- DropForeignKey
ALTER TABLE "BatchHouseAllocation" DROP CONSTRAINT "BatchHouseAllocation_to_house_id_fkey";

-- DropForeignKey
ALTER TABLE "Customers" DROP CONSTRAINT "Customers_profile_id_fkey";

-- DropForeignKey
ALTER TABLE "Doctors" DROP CONSTRAINT "Doctors_profile_id_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeTaskAssignment" DROP CONSTRAINT "EmployeeTaskAssignment_house_id_fkey";

-- DropForeignKey
ALTER TABLE "Employees" DROP CONSTRAINT "Employees_profile_id_fkey";

-- DropForeignKey
ALTER TABLE "InventoryAdjustment" DROP CONSTRAINT "InventoryAdjustment_house_id_fkey";

-- DropForeignKey
ALTER TABLE "InventoryAdjustment" DROP CONSTRAINT "InventoryAdjustment_item_id_fkey";

-- DropForeignKey
ALTER TABLE "InventoryAdjustment" DROP CONSTRAINT "InventoryAdjustment_warehouse_id_fkey";

-- DropForeignKey
ALTER TABLE "StockHouseAllocation" DROP CONSTRAINT "StockHouseAllocation_house_id_fkey";

-- DropForeignKey
ALTER TABLE "Suppliers" DROP CONSTRAINT "Suppliers_profile_id_fkey";

-- AddForeignKey
ALTER TABLE "Employees" ADD CONSTRAINT "Employees_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "Profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admins" ADD CONSTRAINT "Admins_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "Profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customers" ADD CONSTRAINT "Customers_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "Profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suppliers" ADD CONSTRAINT "Suppliers_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "Profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Doctors" ADD CONSTRAINT "Doctors_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "Profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchHouseAllocation" ADD CONSTRAINT "BatchHouseAllocation_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "Batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchHouseAllocation" ADD CONSTRAINT "BatchHouseAllocation_from_house_id_fkey" FOREIGN KEY ("from_house_id") REFERENCES "Houses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchHouseAllocation" ADD CONSTRAINT "BatchHouseAllocation_to_house_id_fkey" FOREIGN KEY ("to_house_id") REFERENCES "Houses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockHouseAllocation" ADD CONSTRAINT "StockHouseAllocation_house_id_fkey" FOREIGN KEY ("house_id") REFERENCES "Houses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "Warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_house_id_fkey" FOREIGN KEY ("house_id") REFERENCES "Houses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeTaskAssignment" ADD CONSTRAINT "EmployeeTaskAssignment_house_id_fkey" FOREIGN KEY ("house_id") REFERENCES "Houses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
