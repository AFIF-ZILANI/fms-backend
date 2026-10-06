-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "revoked_by_id" TEXT;

-- AlterTable
ALTER TABLE "EmployeePayoutAccount" ADD COLUMN     "closed_by_id" TEXT;

-- AlterTable
ALTER TABLE "Employees" ADD COLUMN     "terminated_by_id" TEXT;

-- AlterTable
ALTER TABLE "PerformanceScoreEntry" ADD COLUMN     "acknowledged_by_id" TEXT,
ADD COLUMN     "voided_by_id" TEXT;

-- AddForeignKey
ALTER TABLE "Employees" ADD CONSTRAINT "Employees_terminated_by_id_fkey" FOREIGN KEY ("terminated_by_id") REFERENCES "Profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceScoreEntry" ADD CONSTRAINT "PerformanceScoreEntry_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "Profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceScoreEntry" ADD CONSTRAINT "PerformanceScoreEntry_acknowledged_by_id_fkey" FOREIGN KEY ("acknowledged_by_id") REFERENCES "Profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeePayoutAccount" ADD CONSTRAINT "EmployeePayoutAccount_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "Profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_revoked_by_id_fkey" FOREIGN KEY ("revoked_by_id") REFERENCES "Profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
