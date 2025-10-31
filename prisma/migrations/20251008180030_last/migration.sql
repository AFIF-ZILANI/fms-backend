-- CreateEnum
CREATE TYPE "SoldItemType" AS ENUM ('BIRDS', 'LITTER');

-- CreateEnum
CREATE TYPE "Unit" AS ENUM ('PER_BIRD', 'PER_KG', 'PER_LITER', 'PER_BAG', 'PER_BOX', 'PER_UNIT', 'OTHER');

-- CreateEnum
CREATE TYPE "ExpensesCategory" AS ENUM ('FEED', 'MEDICINE', 'SALARY', 'UTILITIES', 'MAINTENANCE', 'TRANSPORTATION', 'HARDWARE', 'ELEXTRICITY', 'WATER', 'HUSK', 'OTHER');

-- CreateEnum
CREATE TYPE "TimePeriod" AS ENUM ('MORNING', 'NOON', 'AFTERNOON', 'EVENING', 'NIGHT', 'MIDNIGHT', 'LATENIGHT');

-- CreateTable
CREATE TABLE "Medications" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "medication_details" TEXT NOT NULL,
    "administered_by" TEXT NOT NULL,
    "medicine_name" TEXT NOT NULL,
    "dosage" TEXT NOT NULL,
    "cause" TEXT,
    "period" TEXT,
    "doctor_id" TEXT,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Medications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vaccination" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vaccine_details" TEXT,
    "administered_by" TEXT NOT NULL,
    "vaccine_name" TEXT NOT NULL,
    "dosage" INTEGER NOT NULL,
    "cause" TEXT,
    "period" TEXT,
    "doctor_id" TEXT,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vaccination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sales" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delay_for_sale" INTEGER,
    "sold_item_type" "SoldItemType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DOUBLE PRECISION NOT NULL,
    "total_price" DOUBLE PRECISION NOT NULL,
    "customer_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expenses" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" DOUBLE PRECISION NOT NULL,
    "unit" "Unit" NOT NULL,
    "category" "ExpensesCategory" NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "remarks" TEXT,

    CONSTRAINT "Expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyRecords" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "batch_id" TEXT NOT NULL,
    "mortality" INTEGER NOT NULL DEFAULT 0,
    "feed_consumed_bags" DOUBLE PRECISION DEFAULT 0,
    "water_consumed_l" DOUBLE PRECISION DEFAULT 0,
    "avarage_weight_grams" DOUBLE PRECISION DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyRecords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Environment" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "house_no" INTEGER NOT NULL,
    "temperature_c" DOUBLE PRECISION NOT NULL,
    "humidity_percent" DOUBLE PRECISION NOT NULL,
    "ammonia_ppm" DOUBLE PRECISION NOT NULL,
    "co2_ppm" DOUBLE PRECISION NOT NULL,
    "air_pressure_hpa" DOUBLE PRECISION NOT NULL,
    "time_period" "TimePeriod" NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Environment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyRecords_date_key" ON "DailyRecords"("date");

-- AddForeignKey
ALTER TABLE "Medications" ADD CONSTRAINT "Medications_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Medications" ADD CONSTRAINT "Medications_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "Doctor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vaccination" ADD CONSTRAINT "Vaccination_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vaccination" ADD CONSTRAINT "Vaccination_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "Doctor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vaccination" ADD CONSTRAINT "Vaccination_administered_by_fkey" FOREIGN KEY ("administered_by") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sales" ADD CONSTRAINT "Sales_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sales" ADD CONSTRAINT "Sales_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expenses" ADD CONSTRAINT "Expenses_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "Batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyRecords" ADD CONSTRAINT "DailyRecords_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Environment" ADD CONSTRAINT "Environment_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
