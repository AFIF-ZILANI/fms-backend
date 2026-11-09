-- CreateEnum
CREATE TYPE "DiseaseCaseStatus" AS ENUM ('ACTIVE', 'RESOLVED');

-- CreateEnum
CREATE TYPE "DiseaseSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "DiagnosisMethod" AS ENUM ('FIELD', 'POST_MORTEM', 'LAB');

-- CreateEnum
CREATE TYPE "DiseaseOutcome" AS ENUM ('RECOVERED', 'CULLED', 'SOLD_EARLY');

-- AlterTable
ALTER TABLE "Medications" ADD COLUMN     "disease_case_id" TEXT;

-- AlterTable
ALTER TABLE "MortalityLog" ADD COLUMN     "disease_case_id" TEXT;

-- CreateTable
CREATE TABLE "Disease" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Disease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiseaseCase" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "disease_id" TEXT NOT NULL,
    "status" "DiseaseCaseStatus" NOT NULL DEFAULT 'ACTIVE',
    "severity" "DiseaseSeverity" NOT NULL,
    "symptoms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "affected_count" INTEGER,
    "diagnosis_method" "DiagnosisMethod" NOT NULL,
    "doctor_id" TEXT,
    "noticed_on" TIMESTAMP(3) NOT NULL,
    "resolved_on" TIMESTAMP(3),
    "outcome" "DiseaseOutcome",
    "notes" TEXT,
    "recorded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiseaseCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_DiseaseCaseToHouses" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_DiseaseCaseToHouses_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Disease_code_key" ON "Disease"("code");

-- CreateIndex
CREATE INDEX "DiseaseCase_batch_id_idx" ON "DiseaseCase"("batch_id");

-- CreateIndex
CREATE INDEX "DiseaseCase_status_idx" ON "DiseaseCase"("status");

-- CreateIndex
CREATE INDEX "_DiseaseCaseToHouses_B_index" ON "_DiseaseCaseToHouses"("B");

-- AddForeignKey
ALTER TABLE "MortalityLog" ADD CONSTRAINT "MortalityLog_disease_case_id_fkey" FOREIGN KEY ("disease_case_id") REFERENCES "DiseaseCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Medications" ADD CONSTRAINT "Medications_disease_case_id_fkey" FOREIGN KEY ("disease_case_id") REFERENCES "DiseaseCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiseaseCase" ADD CONSTRAINT "DiseaseCase_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "Batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiseaseCase" ADD CONSTRAINT "DiseaseCase_disease_id_fkey" FOREIGN KEY ("disease_id") REFERENCES "Disease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiseaseCase" ADD CONSTRAINT "DiseaseCase_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "Doctors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiseaseCase" ADD CONSTRAINT "DiseaseCase_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "Profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DiseaseCaseToHouses" ADD CONSTRAINT "_DiseaseCaseToHouses_A_fkey" FOREIGN KEY ("A") REFERENCES "DiseaseCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DiseaseCaseToHouses" ADD CONSTRAINT "_DiseaseCaseToHouses_B_fkey" FOREIGN KEY ("B") REFERENCES "Houses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Common broiler diseases to start with; more are added in Settings.
INSERT INTO "Disease" ("id", "code", "label", "updated_at") VALUES
  (gen_random_uuid()::text, 'NEWCASTLE_RANIKHET', 'Newcastle (Ranikhet)', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'GUMBORO_IBD', 'Gumboro (IBD)', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'CRD', 'CRD', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'COCCIDIOSIS', 'Coccidiosis', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'E_COLI_COLIBACILLOSIS', 'E. coli (Colibacillosis)', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'AVIAN_INFLUENZA', 'Avian Influenza', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'FOWL_CHOLERA', 'Fowl Cholera', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'SALMONELLOSIS', 'Salmonellosis', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'HEAT_STRESS', 'Heat Stress', CURRENT_TIMESTAMP);
