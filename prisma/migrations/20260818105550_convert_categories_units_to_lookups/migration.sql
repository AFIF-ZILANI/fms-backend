/*
  Warnings:

  - You are about to drop the column `supplies` on the `Suppliers` table. All the data in the column will be lost.
  - The `category`/`unit` columns below are converted from enum to TEXT in place via
    `ALTER COLUMN ... TYPE TEXT USING ...::TEXT`, which preserves every existing value —
    hand-patched from Prisma's auto-generated DROP COLUMN/ADD COLUMN (which would have
    discarded the data) because these columns are NOT NULL and already contain rows.

*/
-- AlterTable: convert enum columns to TEXT in place (safe cast, no data loss)
ALTER TABLE "Item" ALTER COLUMN "category" TYPE TEXT USING "category"::TEXT;
ALTER TABLE "Item" ALTER COLUMN "unit" TYPE TEXT USING "unit"::TEXT;

-- AlterTable
ALTER TABLE "PurchaseItem" ALTER COLUMN "unit" TYPE TEXT USING "unit"::TEXT;

-- AlterTable
ALTER TABLE "SaleItem" ALTER COLUMN "unit" TYPE TEXT USING "unit"::TEXT;

-- AlterTable
ALTER TABLE "Expense" ALTER COLUMN "category" TYPE TEXT USING "category"::TEXT;

-- DropIndex
DROP INDEX "Suppliers_supplies_idx";

-- Backfill: catch any Suppliers.supplies data not yet migrated into SupplierSupplyLink
-- (Task 3's backfill script covers dev; this guards any environment where the script
-- didn't run between migrations, so the DROP COLUMN below never silently loses data).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Suppliers" s, unnest(s.supplies) AS supply_code
    WHERE NOT EXISTS (SELECT 1 FROM "SupplierSupplyCategory" c WHERE c.code = supply_code::text)
  ) THEN
    RAISE EXCEPTION 'Suppliers.supplies contains a code with no matching SupplierSupplyCategory -- run scripts/backfill-lookup-tables.ts first';
  END IF;
END $$;

INSERT INTO "SupplierSupplyLink" (supplier_id, category_id)
SELECT s.id, c.id
FROM "Suppliers" s, unnest(s.supplies) AS supply_code
JOIN "SupplierSupplyCategory" c ON c.code = supply_code::text
ON CONFLICT DO NOTHING;

-- AlterTable
ALTER TABLE "Suppliers" DROP COLUMN "supplies";

-- DropEnum
DROP TYPE "ExpenseCategory";

-- DropEnum
DROP TYPE "ResourceCategories";

-- DropEnum
DROP TYPE "SupplierSupplyCategories";

-- DropEnum
DROP TYPE "Units";

-- AddForeignKey
ALTER TABLE "SupplierSupplyLink" ADD CONSTRAINT "SupplierSupplyLink_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "Suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierSupplyLink" ADD CONSTRAINT "SupplierSupplyLink_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "SupplierSupplyCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_category_fkey" FOREIGN KEY ("category") REFERENCES "ItemCategory"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_unit_fkey" FOREIGN KEY ("unit") REFERENCES "Unit"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_unit_fkey" FOREIGN KEY ("unit") REFERENCES "Unit"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_unit_fkey" FOREIGN KEY ("unit") REFERENCES "Unit"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_category_fkey" FOREIGN KEY ("category") REFERENCES "ExpenseCategoryLookup"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
