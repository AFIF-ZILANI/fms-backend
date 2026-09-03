-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'DONE', 'CANCELLED');

-- AlterTable
-- Added nullable, backfilled, then constrained: both tables can already hold rows
-- (Alerts does), and a bare `ADD COLUMN ... NOT NULL` with no default fails on them.
-- The backfill value is what the services generate anyway when the client omits a
-- key (`data.idempotency_key ?? crypto.randomUUID()`), so pre-existing rows end up
-- indistinguishable from ones written after this migration.
ALTER TABLE "Alerts" ADD COLUMN "idempotency_key" TEXT;
UPDATE "Alerts" SET "idempotency_key" = gen_random_uuid()::TEXT WHERE "idempotency_key" IS NULL;
ALTER TABLE "Alerts" ALTER COLUMN "idempotency_key" SET NOT NULL;

-- AlterTable
ALTER TABLE "BatchFeedingProgram" ADD COLUMN "idempotency_key" TEXT;
UPDATE "BatchFeedingProgram" SET "idempotency_key" = gen_random_uuid()::TEXT WHERE "idempotency_key" IS NULL;
ALTER TABLE "BatchFeedingProgram" ALTER COLUMN "idempotency_key" SET NOT NULL;

-- AlterTable
-- Nullable on purpose: 137 StockUnits already exist with no recorded binder, and
-- inventing an actor for them would be a fabricated audit trail.
ALTER TABLE "StockUnit" ADD COLUMN     "bound_by_id" TEXT;

-- CreateTable
CREATE TABLE "TaskType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tasks" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "task_type_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeTaskAssignment" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "assigned_by_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "house_id" TEXT,
    "location_note" TEXT,
    "due_at" TIMESTAMP(3) NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "completed_at" TIMESTAMP(3),
    "completion_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "idempotency_key" TEXT NOT NULL,

    CONSTRAINT "EmployeeTaskAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskType_code_key" ON "TaskType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Tasks_code_key" ON "Tasks"("code");

-- CreateIndex
CREATE INDEX "Tasks_task_type_id_idx" ON "Tasks"("task_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeTaskAssignment_idempotency_key_key" ON "EmployeeTaskAssignment"("idempotency_key");

-- CreateIndex
CREATE INDEX "EmployeeTaskAssignment_employee_id_status_due_at_idx" ON "EmployeeTaskAssignment"("employee_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "EmployeeTaskAssignment_house_id_idx" ON "EmployeeTaskAssignment"("house_id");

-- CreateIndex
CREATE UNIQUE INDEX "Alerts_idempotency_key_key" ON "Alerts"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "BatchFeedingProgram_idempotency_key_key" ON "BatchFeedingProgram"("idempotency_key");

-- AddForeignKey
ALTER TABLE "Tasks" ADD CONSTRAINT "Tasks_task_type_id_fkey" FOREIGN KEY ("task_type_id") REFERENCES "TaskType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockUnit" ADD CONSTRAINT "StockUnit_bound_by_id_fkey" FOREIGN KEY ("bound_by_id") REFERENCES "Profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeTaskAssignment" ADD CONSTRAINT "EmployeeTaskAssignment_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeTaskAssignment" ADD CONSTRAINT "EmployeeTaskAssignment_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "Profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeTaskAssignment" ADD CONSTRAINT "EmployeeTaskAssignment_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "Tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeTaskAssignment" ADD CONSTRAINT "EmployeeTaskAssignment_house_id_fkey" FOREIGN KEY ("house_id") REFERENCES "Houses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
