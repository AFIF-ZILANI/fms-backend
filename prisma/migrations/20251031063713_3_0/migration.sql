/*
  Warnings:

  - Added the required column `is_from_registerd_supplier` to the `Batch` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `breed` on the `Batch` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "BirdBreed" AS ENUM ('CLASSIC', 'HIBREED', 'PAKISTHANI', 'KEDERNATH', 'FAOMI', 'TIGER');

-- AlterTable
ALTER TABLE "Batch" ADD COLUMN     "is_from_registerd_supplier" BOOLEAN NOT NULL,
DROP COLUMN "breed",
ADD COLUMN     "breed" "BirdBreed" NOT NULL;

-- AlterTable
ALTER TABLE "Employee" ALTER COLUMN "email" DROP NOT NULL;
