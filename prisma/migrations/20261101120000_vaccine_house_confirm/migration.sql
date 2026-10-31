-- DropIndex
DROP INDEX "BatchVaccineSchedule_confirm_key_key";

-- AlterTable
ALTER TABLE "BatchVaccineSchedule" DROP COLUMN "confirm_key";

-- CreateTable
CREATE TABLE "BatchVaccineHouseConfirm" (
    "id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "house_id" TEXT NOT NULL,
    "confirmed_by_id" TEXT NOT NULL,
    "confirmed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirm_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BatchVaccineHouseConfirm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BatchVaccineHouseConfirm_confirm_key_key" ON "BatchVaccineHouseConfirm"("confirm_key");

-- CreateIndex
CREATE UNIQUE INDEX "BatchVaccineHouseConfirm_schedule_id_house_id_key" ON "BatchVaccineHouseConfirm"("schedule_id", "house_id");

-- AddForeignKey
ALTER TABLE "BatchVaccineHouseConfirm" ADD CONSTRAINT "BatchVaccineHouseConfirm_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "BatchVaccineSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchVaccineHouseConfirm" ADD CONSTRAINT "BatchVaccineHouseConfirm_house_id_fkey" FOREIGN KEY ("house_id") REFERENCES "Houses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchVaccineHouseConfirm" ADD CONSTRAINT "BatchVaccineHouseConfirm_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "Profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

