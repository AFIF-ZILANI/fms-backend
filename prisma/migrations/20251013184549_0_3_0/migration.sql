/*
  Warnings:

  - You are about to drop the column `photo` on the `Admin` table. All the data in the column will be lost.
  - You are about to drop the column `photo` on the `Customer` table. All the data in the column will be lost.
  - You are about to drop the column `photo` on the `Doctor` table. All the data in the column will be lost.
  - You are about to drop the column `photo` on the `Employee` table. All the data in the column will be lost.
  - You are about to drop the column `photo` on the `Pharmacist` table. All the data in the column will be lost.
  - You are about to drop the column `photo` on the `Supplier` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[avatar_id]` on the table `Admin` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[avatar_id]` on the table `Customer` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[avatar_id]` on the table `Doctor` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[avatar_id]` on the table `Employee` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[avatar_id]` on the table `Pharmacist` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[avatar_id]` on the table `Supplier` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Admin" DROP COLUMN "photo",
ADD COLUMN     "avatar_id" TEXT;

-- AlterTable
ALTER TABLE "Customer" DROP COLUMN "photo",
ADD COLUMN     "avatar_id" TEXT;

-- AlterTable
ALTER TABLE "Doctor" DROP COLUMN "photo",
ADD COLUMN     "avatar_id" TEXT;

-- AlterTable
ALTER TABLE "Employee" DROP COLUMN "photo",
ADD COLUMN     "avatar_id" TEXT;

-- AlterTable
ALTER TABLE "Pharmacist" DROP COLUMN "photo",
ADD COLUMN     "avatar_id" TEXT;

-- AlterTable
ALTER TABLE "Supplier" DROP COLUMN "photo",
ADD COLUMN     "avatar_id" TEXT;

-- CreateTable
CREATE TABLE "Images" (
    "id" TEXT NOT NULL,
    "public_id" TEXT NOT NULL,
    "image_url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Admin_avatar_id_key" ON "Admin"("avatar_id");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_avatar_id_key" ON "Customer"("avatar_id");

-- CreateIndex
CREATE UNIQUE INDEX "Doctor_avatar_id_key" ON "Doctor"("avatar_id");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_avatar_id_key" ON "Employee"("avatar_id");

-- CreateIndex
CREATE UNIQUE INDEX "Pharmacist_avatar_id_key" ON "Pharmacist"("avatar_id");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_avatar_id_key" ON "Supplier"("avatar_id");

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_avatar_id_fkey" FOREIGN KEY ("avatar_id") REFERENCES "Images"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admin" ADD CONSTRAINT "Admin_avatar_id_fkey" FOREIGN KEY ("avatar_id") REFERENCES "Images"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_avatar_id_fkey" FOREIGN KEY ("avatar_id") REFERENCES "Images"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_avatar_id_fkey" FOREIGN KEY ("avatar_id") REFERENCES "Images"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Doctor" ADD CONSTRAINT "Doctor_avatar_id_fkey" FOREIGN KEY ("avatar_id") REFERENCES "Images"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pharmacist" ADD CONSTRAINT "Pharmacist_avatar_id_fkey" FOREIGN KEY ("avatar_id") REFERENCES "Images"("id") ON DELETE SET NULL ON UPDATE CASCADE;
