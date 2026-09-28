-- CreateEnum
CREATE TYPE "ScoreEntryStatus" AS ENUM ('ACTIVE', 'DISPUTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "PayoutMethod" AS ENUM ('BANK', 'BKASH', 'NAGAD', 'ROCKET', 'CASH');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'CONFIRMED');

-- Employees: salary becomes the reference salary, with the guaranteed wage at 0.9 of it.
-- Added nullable, backfilled, then tightened -- a NOT NULL add would fail on the rows
-- already here.
ALTER TABLE "Employees" ADD COLUMN "reference_salary" DECIMAL(10,2),
                        ADD COLUMN "fixed_wage" DECIMAL(10,2);
UPDATE "Employees" SET "reference_salary" = "salary",
                       "fixed_wage" = ROUND("salary" * 0.9, 2);
ALTER TABLE "Employees" ALTER COLUMN "reference_salary" SET NOT NULL,
                        ALTER COLUMN "fixed_wage" SET NOT NULL;
ALTER TABLE "Employees" DROP COLUMN "salary";

-- PayrollRecord: past runs were computed under the old baseline × adjustment formula.
-- They are re-expressed in the new shape without changing what anyone was actually
-- paid: total_pay keeps the old final_salary, and the allowance is whatever that
-- figure exceeded the guaranteed wage by.
ALTER TABLE "PayrollRecord" ADD COLUMN "reference_salary" DECIMAL(10,2),
                            ADD COLUMN "fixed_wage" DECIMAL(10,2),
                            ADD COLUMN "allowance" DECIMAL(10,2),
                            ADD COLUMN "total_pay" DECIMAL(10,2),
                            ADD COLUMN "locked_at" TIMESTAMP(3);
UPDATE "PayrollRecord" SET "reference_salary" = "baseline_salary",
                           "fixed_wage" = ROUND("baseline_salary" * 0.9, 2),
                           "total_pay" = "final_salary",
                           "allowance" = "final_salary" - ROUND("baseline_salary" * 0.9, 2),
                           "locked_at" = "created_at";
ALTER TABLE "PayrollRecord" ALTER COLUMN "reference_salary" SET NOT NULL,
                            ALTER COLUMN "fixed_wage" SET NOT NULL,
                            ALTER COLUMN "allowance" SET NOT NULL,
                            ALTER COLUMN "total_pay" SET NOT NULL,
                            ALTER COLUMN "locked_at" SET NOT NULL,
                            ALTER COLUMN "locked_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "PayrollRecord" DROP COLUMN "baseline_salary",
                            DROP COLUMN "final_salary";
-- P is a clamped sum of integer points, so nothing is lost rounding the old Decimal.
ALTER TABLE "PayrollRecord" ALTER COLUMN "adjustment_percent" SET DATA TYPE INTEGER
  USING ROUND("adjustment_percent")::INTEGER;

-- PerformanceScoreEntry: `date` becomes `incident_date` -- renamed, not dropped and
-- recreated, so existing entries keep the day they were recorded for.
ALTER TABLE "PerformanceScoreEntry" RENAME COLUMN "date" TO "incident_date";
ALTER TABLE "PerformanceScoreEntry" ALTER COLUMN "incident_date" DROP DEFAULT;
ALTER TABLE "PerformanceScoreEntry" ADD COLUMN "acknowledged_at" TIMESTAMP(3),
                                    ADD COLUMN "approved_by_id" TEXT,
                                    ADD COLUMN "notice_doc_url" TEXT,
                                    ADD COLUMN "status" "ScoreEntryStatus" NOT NULL DEFAULT 'ACTIVE',
                                    ADD COLUMN "void_reason" TEXT;

-- DropIndex
DROP INDEX "PerformanceScoreEntry_employee_id_date_idx";

-- CreateTable
CREATE TABLE "EmployeePayoutAccount" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "method" "PayoutMethod" NOT NULL,
    "account_name" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "bank_name" TEXT,
    "branch_name" TEXT,
    "routing_number" TEXT,
    "holder_relation" TEXT,
    "consent_doc_url" TEXT,
    "verified_by_id" TEXT,
    "verified_at" TIMESTAMP(3),
    "active_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active_to" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeePayoutAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollPayout" (
    "id" TEXT NOT NULL,
    "payroll_record_id" TEXT NOT NULL,
    "payout_account_id" TEXT,
    "method" "PayoutMethod" NOT NULL,
    "account_number" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "fee_paid_by_farm" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "transaction_ref" TEXT,
    "receipt_doc_url" TEXT,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "paid_by_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeePayoutAccount_employee_id_active_to_idx" ON "EmployeePayoutAccount"("employee_id", "active_to");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPayout_payroll_record_id_key" ON "PayrollPayout"("payroll_record_id");

-- CreateIndex
CREATE INDEX "PerformanceScoreEntry_employee_id_incident_date_idx" ON "PerformanceScoreEntry"("employee_id", "incident_date");

-- AddForeignKey
ALTER TABLE "PerformanceScoreEntry" ADD CONSTRAINT "PerformanceScoreEntry_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "Profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeePayoutAccount" ADD CONSTRAINT "EmployeePayoutAccount_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeePayoutAccount" ADD CONSTRAINT "EmployeePayoutAccount_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "Profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPayout" ADD CONSTRAINT "PayrollPayout_payroll_record_id_fkey" FOREIGN KEY ("payroll_record_id") REFERENCES "PayrollRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPayout" ADD CONSTRAINT "PayrollPayout_payout_account_id_fkey" FOREIGN KEY ("payout_account_id") REFERENCES "EmployeePayoutAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPayout" ADD CONSTRAINT "PayrollPayout_paid_by_id_fkey" FOREIGN KEY ("paid_by_id") REFERENCES "Profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

