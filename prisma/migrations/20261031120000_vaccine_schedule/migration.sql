-- CreateEnum
CREATE TYPE "VaccineScheduleStatus" AS ENUM ('PENDING', 'DONE', 'CANCELLED');

-- AlterTable
ALTER TABLE "Vaccinations" ADD COLUMN     "schedule_id" TEXT,
ALTER COLUMN "dosage" SET DATA TYPE DECIMAL(10,3);

-- CreateTable
CREATE TABLE "VaccineTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaccineTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaccineTemplateEntry" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "day" INTEGER NOT NULL,
    "item_id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "method" TEXT,
    "note" TEXT,

    CONSTRAINT "VaccineTemplateEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchVaccineSchedule" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "template_id" TEXT,
    "item_id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "method" TEXT,
    "note" TEXT,
    "planned_day" INTEGER NOT NULL,
    "day" INTEGER NOT NULL,
    "status" "VaccineScheduleStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "confirmed_by_id" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "confirm_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BatchVaccineSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VaccineTemplate_name_key" ON "VaccineTemplate"("name");

-- CreateIndex
CREATE INDEX "VaccineTemplateEntry_template_id_day_idx" ON "VaccineTemplateEntry"("template_id", "day");

-- CreateIndex
CREATE UNIQUE INDEX "BatchVaccineSchedule_confirm_key_key" ON "BatchVaccineSchedule"("confirm_key");

-- CreateIndex
CREATE INDEX "BatchVaccineSchedule_batch_id_day_idx" ON "BatchVaccineSchedule"("batch_id", "day");

-- CreateIndex
CREATE INDEX "Vaccinations_schedule_id_idx" ON "Vaccinations"("schedule_id");

-- AddForeignKey
ALTER TABLE "Vaccinations" ADD CONSTRAINT "Vaccinations_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "BatchVaccineSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaccineTemplateEntry" ADD CONSTRAINT "VaccineTemplateEntry_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "VaccineTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaccineTemplateEntry" ADD CONSTRAINT "VaccineTemplateEntry_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchVaccineSchedule" ADD CONSTRAINT "BatchVaccineSchedule_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "Batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchVaccineSchedule" ADD CONSTRAINT "BatchVaccineSchedule_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "VaccineTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchVaccineSchedule" ADD CONSTRAINT "BatchVaccineSchedule_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchVaccineSchedule" ADD CONSTRAINT "BatchVaccineSchedule_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "Profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

