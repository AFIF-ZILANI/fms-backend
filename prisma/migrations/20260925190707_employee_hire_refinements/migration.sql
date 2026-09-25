/*
  Warnings:

  - You are about to drop the column `reference_relation` on the `Employees` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Employees" DROP COLUMN "reference_relation",
ADD COLUMN     "emergency_address" TEXT,
ADD COLUMN     "emergency_email" TEXT,
ADD COLUMN     "experience_years" INTEGER,
ADD COLUMN     "reference_address" TEXT,
ADD COLUMN     "reference_employee_id" TEXT;

-- CreateIndex
CREATE INDEX "Employees_reference_employee_id_idx" ON "Employees"("reference_employee_id");

-- AddForeignKey
ALTER TABLE "Employees" ADD CONSTRAINT "Employees_reference_employee_id_fkey" FOREIGN KEY ("reference_employee_id") REFERENCES "Employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
