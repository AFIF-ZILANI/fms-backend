-- AlterTable
ALTER TABLE "BatchVaccineHouseConfirm" ADD COLUMN     "via_house_id" TEXT;

-- AlterTable
ALTER TABLE "Houses" ADD COLUMN     "water_line" TEXT;

-- AddForeignKey
ALTER TABLE "BatchVaccineHouseConfirm" ADD CONSTRAINT "BatchVaccineHouseConfirm_via_house_id_fkey" FOREIGN KEY ("via_house_id") REFERENCES "Houses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
