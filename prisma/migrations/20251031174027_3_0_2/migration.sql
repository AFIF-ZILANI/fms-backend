/*
  Warnings:

  - You are about to drop the column `batch_name` on the `Batch` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[batch_id]` on the table `Batch` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `batch_id` to the `Batch` table without a default value. This is not possible if the table is not empty.
  - Added the required column `farm_code` to the `Batch` table without a default value. This is not possible if the table is not empty.
  - Added the required column `product_code` to the `Batch` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sector_code` to the `Batch` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "public"."Batch_batch_name_key";

-- AlterTable
ALTER TABLE "Batch" DROP COLUMN "batch_name",
ADD COLUMN     "batch_id" TEXT NOT NULL,
ADD COLUMN     "farm_code" TEXT NOT NULL,
ADD COLUMN     "product_code" TEXT NOT NULL,
ADD COLUMN     "sector_code" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Batch_batch_id_key" ON "Batch"("batch_id");

-- CreateIndex
CREATE INDEX "Batch_farm_code_sector_code_product_code_batch_id_idx" ON "Batch"("farm_code", "sector_code", "product_code", "batch_id");
