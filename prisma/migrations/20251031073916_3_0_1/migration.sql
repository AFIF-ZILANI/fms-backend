-- DropForeignKey
ALTER TABLE "public"."Batch" DROP CONSTRAINT "Batch_supplier_id_fkey";

-- AlterTable
ALTER TABLE "Batch" ALTER COLUMN "supplier_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
