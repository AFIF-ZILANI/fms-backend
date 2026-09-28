-- Records when employment ended, so payroll can tell a final month's wage
-- (owed) from a month after the employee left (not).
ALTER TABLE "Employees" ADD COLUMN "terminated_at" TIMESTAMP(3);

-- Employees already terminated predate this column. updated_at is the closest
-- honest approximation of when it happened, and is better than leaving them
-- with no termination date at all -- which would read as "never terminated"
-- and let payroll run for them indefinitely.
UPDATE "Employees" SET "terminated_at" = "updated_at" WHERE "employment_status" = 'TERMINATED';
