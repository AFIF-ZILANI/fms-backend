/*
  Warnings:

  - Added the required column `house_id` to the `BirdSale` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "BirdSale" ADD COLUMN     "house_id" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "BirdSale" ADD CONSTRAINT "BirdSale_house_id_fkey" FOREIGN KEY ("house_id") REFERENCES "Houses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
