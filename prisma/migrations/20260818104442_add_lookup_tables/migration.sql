-- CreateTable
CREATE TABLE "ItemCategory" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCategoryLookup" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseCategoryLookup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierSupplyCategory" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierSupplyCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierSupplyLink" (
    "supplier_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,

    CONSTRAINT "SupplierSupplyLink_pkey" PRIMARY KEY ("supplier_id","category_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ItemCategory_code_key" ON "ItemCategory"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_code_key" ON "Unit"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategoryLookup_code_key" ON "ExpenseCategoryLookup"("code");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierSupplyCategory_code_key" ON "SupplierSupplyCategory"("code");

-- Seed lookup rows so a fresh environment (new clone, CI, restored dump) has the
-- codes the app and test suite reference by literal (e.g. "FEED") instead of
-- landing on four empty tables once the NOT NULL FKs are added in the next migration.
-- Codes/labels copied verbatim from scripts/backfill-lookup-tables.ts.
INSERT INTO "ItemCategory" (id, code, label, updated_at) VALUES
  (gen_random_uuid(), 'FEED', 'Feed', now()),
  (gen_random_uuid(), 'MEDICINE', 'Medicine', now()),
  (gen_random_uuid(), 'VACCINE', 'Vaccine', now()),
  (gen_random_uuid(), 'SUPPLEMENT', 'Supplement', now()),
  (gen_random_uuid(), 'BIOSECURITY', 'Biosecurity', now()),
  (gen_random_uuid(), 'CHICKS', 'Chicks', now()),
  (gen_random_uuid(), 'HUSK', 'Husk', now()),
  (gen_random_uuid(), 'EQUIPMENT', 'Equipment', now()),
  (gen_random_uuid(), 'UTILITIES', 'Utilities', now()),
  (gen_random_uuid(), 'SALARY', 'Salary', now()),
  (gen_random_uuid(), 'TRANSPORTATION', 'Transportation', now()),
  (gen_random_uuid(), 'MAINTENANCE', 'Maintenance', now()),
  (gen_random_uuid(), 'CLEANING_SUPPLIES', 'Cleaning Supplies', now()),
  (gen_random_uuid(), 'WASTE', 'Waste', now()),
  (gen_random_uuid(), 'OTHER', 'Other', now())
ON CONFLICT (code) DO NOTHING;

INSERT INTO "Unit" (id, code, label, updated_at) VALUES
  (gen_random_uuid(), 'BIRD', 'Bird', now()),
  (gen_random_uuid(), 'KG', 'Kg', now()),
  (gen_random_uuid(), 'LITER', 'Liter', now()),
  (gen_random_uuid(), 'BAG', 'Bag', now()),
  (gen_random_uuid(), 'BOX', 'Box', now()),
  (gen_random_uuid(), 'UNIT', 'Unit', now()),
  (gen_random_uuid(), 'SACHETS', 'Sachets', now()),
  (gen_random_uuid(), 'BOTTLE', 'Bottle', now()),
  (gen_random_uuid(), 'ML', 'Ml', now()),
  (gen_random_uuid(), 'L', 'L', now()),
  (gen_random_uuid(), 'G', 'G', now()),
  (gen_random_uuid(), 'PCS', 'Pcs', now()),
  (gen_random_uuid(), 'VIAL', 'Vial', now()),
  (gen_random_uuid(), 'DOSE', 'Dose', now()),
  (gen_random_uuid(), 'OTHER', 'Other', now())
ON CONFLICT (code) DO NOTHING;

INSERT INTO "ExpenseCategoryLookup" (id, code, label, updated_at) VALUES
  (gen_random_uuid(), 'LABOR', 'Labor', now()),
  (gen_random_uuid(), 'ELECTRICITY', 'Electricity', now()),
  (gen_random_uuid(), 'WATER', 'Water', now()),
  (gen_random_uuid(), 'RENT', 'Rent', now()),
  (gen_random_uuid(), 'TRANSPORT', 'Transport', now()),
  (gen_random_uuid(), 'FUEL', 'Fuel', now()),
  (gen_random_uuid(), 'MAINTENANCE', 'Maintenance', now()),
  (gen_random_uuid(), 'VET_FEE', 'Vet Fee', now()),
  (gen_random_uuid(), 'INTERNET', 'Internet', now()),
  (gen_random_uuid(), 'MISC', 'Misc', now())
ON CONFLICT (code) DO NOTHING;

INSERT INTO "SupplierSupplyCategory" (id, code, label, updated_at) VALUES
  (gen_random_uuid(), 'FEED', 'Feed', now()),
  (gen_random_uuid(), 'MEDICINE', 'Medicine', now()),
  (gen_random_uuid(), 'CHICKS', 'Chicks', now()),
  (gen_random_uuid(), 'HUSK', 'Husk', now()),
  (gen_random_uuid(), 'EQUIPMENT', 'Equipment', now()),
  (gen_random_uuid(), 'UTILITIES', 'Utilities', now()),
  (gen_random_uuid(), 'TRANSPORTATION', 'Transportation', now()),
  (gen_random_uuid(), 'CLEANING_SUPPLIES', 'Cleaning Supplies', now()),
  (gen_random_uuid(), 'OFFICE_SUPPLIES', 'Office Supplies', now()),
  (gen_random_uuid(), 'SOFTWARE', 'Software', now()),
  (gen_random_uuid(), 'OTHER', 'Other', now())
ON CONFLICT (code) DO NOTHING;
