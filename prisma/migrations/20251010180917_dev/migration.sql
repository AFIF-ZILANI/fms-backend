/*
  Warnings:

  - The values [DILLER] on the enum `SupplierRoleName` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the `EmployeeRole` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `role` to the `Employee` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "EmployeeRoleName" AS ENUM ('MANAGER', 'WORKER', 'INTERN');

-- AlterEnum
BEGIN;
CREATE TYPE "SupplierRoleName_new" AS ENUM ('SALES_MAN', 'OWNER', 'DISTRIBUTOR', 'DEALER', 'WHOLESALER', 'RETAILER', 'MANUFACTURER', 'IMPORTER', 'REPRESENTATIVE');
ALTER TABLE "Supplier" ALTER COLUMN "role" TYPE "SupplierRoleName_new" USING ("role"::text::"SupplierRoleName_new");
ALTER TYPE "SupplierRoleName" RENAME TO "SupplierRoleName_old";
ALTER TYPE "SupplierRoleName_new" RENAME TO "SupplierRoleName";
DROP TYPE "public"."SupplierRoleName_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "public"."EmployeeRole" DROP CONSTRAINT "EmployeeRole_employeeId_fkey";

-- AlterTable
ALTER TABLE "Customer" ALTER COLUMN "rating" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "Doctor" ALTER COLUMN "rating" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "online_contact" "ContactMethod"[],
ADD COLUMN     "role" "EmployeeRoleName" NOT NULL,
ALTER COLUMN "rating" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "Pharmacist" ALTER COLUMN "rating" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "Supplier" ALTER COLUMN "rating" SET DEFAULT 0;

-- DropTable
DROP TABLE "public"."EmployeeRole";

-- DropEnum
DROP TYPE "public"."RoleName";
