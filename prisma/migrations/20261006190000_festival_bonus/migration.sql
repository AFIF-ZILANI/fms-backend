-- Festival bonus (docs/superpowers/specs/2026-09-30-festival-bonus-design.md).
-- Hand-written: Prisma's diff drops PayrollPayout and creates EmployeePayout, which would lose
-- every live payout. This renames the table instead, so rows, ids and the Payment.ref_id values
-- that point at them stay valid.

-- Religion: sensitive and optional, decides only who a bonus proposes.
CREATE TYPE "Religion" AS ENUM ('ISLAM', 'HINDU', 'CHRISTIANITY', 'BUDDHISM', 'OTHER');
ALTER TABLE "Employees" ADD COLUMN "religion" "Religion";

-- The event and what each employee was granted at it.
CREATE TABLE "BonusEvent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "event_date" TIMESTAMP(3) NOT NULL,
    "religion" "Religion",
    "multiplier" DECIMAL(4,2) NOT NULL,
    "min_service_months" INTEGER NOT NULL DEFAULT 12,
    "prorate" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BonusEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Bonus" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "reference_salary" DECIMAL(10,2) NOT NULL,
    "service_months" INTEGER NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bonus_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Bonus_employee_id_idx" ON "Bonus"("employee_id");
CREATE UNIQUE INDEX "Bonus_event_id_employee_id_key" ON "Bonus"("event_id", "employee_id");

ALTER TABLE "BonusEvent" ADD CONSTRAINT "BonusEvent_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "Profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Bonus" ADD CONSTRAINT "Bonus_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "BonusEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Bonus" ADD CONSTRAINT "Bonus_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- PayrollPayout -> EmployeePayout: one payout path for all money to an employee.
ALTER TABLE "PayrollPayout" RENAME TO "EmployeePayout";
ALTER TABLE "EmployeePayout" RENAME CONSTRAINT "PayrollPayout_pkey" TO "EmployeePayout_pkey";
ALTER INDEX "PayrollPayout_payroll_record_id_key" RENAME TO "EmployeePayout_payroll_record_id_key";
ALTER TABLE "EmployeePayout" RENAME CONSTRAINT "PayrollPayout_paid_by_id_fkey" TO "EmployeePayout_paid_by_id_fkey";
ALTER TABLE "EmployeePayout" RENAME CONSTRAINT "PayrollPayout_payout_account_id_fkey" TO "EmployeePayout_payout_account_id_fkey";

-- payroll_record_id becomes optional (a bonus payout has none), which also changes its FK action.
ALTER TABLE "EmployeePayout" DROP CONSTRAINT "PayrollPayout_payroll_record_id_fkey";
ALTER TABLE "EmployeePayout" ALTER COLUMN "payroll_record_id" DROP NOT NULL;
ALTER TABLE "EmployeePayout" ADD CONSTRAINT "EmployeePayout_payroll_record_id_fkey" FOREIGN KEY ("payroll_record_id") REFERENCES "PayrollRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EmployeePayout" ADD COLUMN "bonus_id" TEXT;
CREATE UNIQUE INDEX "EmployeePayout_bonus_id_key" ON "EmployeePayout"("bonus_id");
ALTER TABLE "EmployeePayout" ADD CONSTRAINT "EmployeePayout_bonus_id_fkey" FOREIGN KEY ("bonus_id") REFERENCES "Bonus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Exactly one of the two links. Prisma can't express a CHECK. Every existing row has a
-- payroll record and no bonus, so this holds on the data already here.
ALTER TABLE "EmployeePayout" ADD CONSTRAINT "EmployeePayout_one_link"
  CHECK (("payroll_record_id" IS NULL) <> ("bonus_id" IS NULL));
