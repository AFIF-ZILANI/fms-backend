/*
  Warnings:

  - The values [FURNITURE] on the enum `SupplyType` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `is_registered` on the `Supplier` table. All the data in the column will be lost.

*/
-- AlterEnum
ALTER TYPE "ContactMethod" ADD VALUE 'TELEGRAM';

-- AlterEnum
BEGIN;
CREATE TYPE "SupplyType_new" AS ENUM ('MEDICINE', 'FEED', 'HUSK', 'HARDWARE', 'MEDICAL_EQUIPMENT', 'LAB_EQUIPMENT', 'OFFICE_SUPPLIES', 'CLEANING_SUPPLIES', 'IT_HARDWARE', 'SOFTWARE', 'IT_EQUEPMENT', 'INTERNET', 'ELECTRICAL_EQUIPMENT', 'OTHER');
ALTER TABLE "Supplier" ALTER COLUMN "type" TYPE "SupplyType_new"[] USING ("type"::text::"SupplyType_new"[]);
ALTER TYPE "SupplyType" RENAME TO "SupplyType_old";
ALTER TYPE "SupplyType_new" RENAME TO "SupplyType";
DROP TYPE "public"."SupplyType_old";
COMMIT;

-- AlterTable
ALTER TABLE "Supplier" DROP COLUMN "is_registered";
