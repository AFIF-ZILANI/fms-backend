-- EmployeeRoleNames was an enum, so adding a role meant a migration and a
-- deploy. It becomes a table carrying each role's standard salary, editable in
-- Settings. See docs/superpowers/specs/2026-09-30-role-salary-config-design.md.

CREATE TABLE "EmployeeRole" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "reference_salary" DECIMAL(10,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmployeeRole_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EmployeeRole_code_key" ON "EmployeeRole"("code");

-- Seeded from the enum's values so every existing Employees.role still resolves.
-- The salaries are STARTING POINTS THE OWNER MUST CONFIRM in Settings: MANAGER is
-- unambiguous at 15,000, but WORKER currently spans 5,000/10,000/12,000/15,000
-- with no mode, so it takes the highest, and no INTERN exists to infer from.
-- A wrong seed cannot move anyone's pay, because every existing employee keeps
-- an override (see below).
INSERT INTO "EmployeeRole" ("id", "code", "label", "reference_salary", "is_active", "created_at", "updated_at")
VALUES
    (gen_random_uuid(), 'MANAGER', 'Manager', 15000, true, NOW(), NOW()),
    (gen_random_uuid(), 'WORKER',  'Worker',  15000, true, NOW(), NOW()),
    (gen_random_uuid(), 'INTERN',  'Intern',   8000, true, NOW(), NOW());

-- The enum values and the seeded codes are identical strings, so the cast is
-- lossless and every row keeps the role it had.
ALTER TABLE "Employees" ALTER COLUMN "role" TYPE TEXT USING ("role"::text);

ALTER TABLE "Employees" ADD CONSTRAINT "Employees_role_fkey"
    FOREIGN KEY ("role") REFERENCES "EmployeeRole"("code")
    ON UPDATE CASCADE ON DELETE RESTRICT;

-- ON DELETE RESTRICT is what makes the delete guard in the service work: Postgres
-- raises, Prisma reports P2003, and the API answers "deactivate it instead".

DROP TYPE "EmployeeRoleNames";

-- Nullable from here on: null means "use the role's standard". Every existing row
-- keeps its current figure, so all of them are overrides and no role standard
-- drives anyone's pay today.
ALTER TABLE "Employees" ALTER COLUMN "reference_salary" DROP NOT NULL;

-- Always 0.9 x reference_salary, and PayrollRecordService.generate() already
-- recomputed it rather than reading this column -- so the "must survive a ratio
-- change" rule its comment claimed has never actually held. The figure that IS
-- immutable is PayrollRecord.fixed_wage, a snapshot in a month-locked row.
ALTER TABLE "Employees" DROP COLUMN "fixed_wage";
