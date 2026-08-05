-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'EMPLOYEE', 'CUSTOMER', 'SUPPLIER', 'DOCTOR');

-- CreateEnum
CREATE TYPE "EmployeeRoleNames" AS ENUM ('MANAGER', 'WORKER', 'INTERN');

-- CreateEnum
CREATE TYPE "SupplierRoleNames" AS ENUM ('SALES_MAN', 'OWNER', 'DISTRIBUTOR', 'DEALER', 'WHOLESALER', 'RETAILER', 'MANUFACTURER', 'IMPORTER', 'REPRESENTATIVE');

-- CreateEnum
CREATE TYPE "ContactMethods" AS ENUM ('WHATSAPP', 'EMAIL', 'IMO', 'TELEGRAM');

-- CreateEnum
CREATE TYPE "Units" AS ENUM ('BIRD', 'KG', 'LITER', 'BAG', 'BOX', 'UNIT', 'SACHETS', 'BOTTLE', 'ML', 'L', 'G', 'PCS', 'VIAL', 'DOSE', 'OTHER');

-- CreateEnum
CREATE TYPE "ResourceCategories" AS ENUM ('FEED', 'MEDICINE', 'VACCINE', 'SUPPLEMENT', 'BIOSECURITY', 'CHICKS', 'HUSK', 'EQUIPMENT', 'UTILITIES', 'SALARY', 'TRANSPORTATION', 'MAINTENANCE', 'CLEANING_SUPPLIES', 'OTHER');

-- CreateEnum
CREATE TYPE "SupplierSupplyCategories" AS ENUM ('FEED', 'MEDICINE', 'CHICKS', 'HUSK', 'EQUIPMENT', 'UTILITIES', 'TRANSPORTATION', 'CLEANING_SUPPLIES', 'OFFICE_SUPPLIES', 'SOFTWARE', 'OTHER');

-- CreateEnum
CREATE TYPE "HouseType" AS ENUM ('BROODER', 'GROWER', 'LAYER');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('RUNNING', 'CLOSED', 'SOLD');

-- CreateEnum
CREATE TYPE "Phase" AS ENUM ('BROODER', 'GROWER');

-- CreateEnum
CREATE TYPE "BirdBreeds" AS ENUM ('CLASSIC', 'HIBREED', 'PAKISTHANI', 'KEDERNATH', 'FAOMI', 'TIGER');

-- CreateEnum
CREATE TYPE "AllocationReason" AS ENUM ('INITIAL', 'TRANSFER', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "TimePeriods" AS ENUM ('MORNING', 'NOON', 'AFTERNOON', 'EVENING', 'NIGHT', 'MIDNIGHT', 'LATENIGHT');

-- CreateEnum
CREATE TYPE "FeedType" AS ENUM ('PRE_STARTER', 'STARTER', 'GROWER', 'FINISHER', 'LAYER');

-- CreateEnum
CREATE TYPE "CostType" AS ENUM ('DIRECT', 'SHARED_PERIOD', 'SHARED_CAPITAL');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('LABOR', 'ELECTRICITY', 'WATER', 'RENT', 'TRANSPORT', 'FUEL', 'MAINTENANCE', 'VET_FEE', 'INTERNET', 'MISC');

-- CreateEnum
CREATE TYPE "StockUnitStatus" AS ENUM ('UNASSIGNED', 'IN_STOCK', 'IN_USE', 'CONSUMED', 'DISPOSED');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('ACTIVE', 'RETIRED', 'DISPOSED');

-- CreateEnum
CREATE TYPE "StockDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "StockReason" AS ENUM ('PURCHASE', 'TRANSFER', 'CONSUMPTION', 'WASTAGE', 'EXPIRED', 'ADJUSTMENT', 'OPENING_BALANCE');

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('WAREHOUSE', 'HOUSE', 'DISPOSAL');

-- CreateEnum
CREATE TYPE "RefType" AS ENUM ('PURCHASE', 'CONSUMPTION', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "OrganizationRole" AS ENUM ('MANUFACTURER', 'IMPORTER', 'MARKETER', 'DISTRIBUTOR');

-- CreateEnum
CREATE TYPE "BirdGrade" AS ENUM ('HIGH', 'LOW', 'CULL');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'MFS');

-- CreateEnum
CREATE TYPE "MfsType" AS ENUM ('BKASH', 'NAGAD', 'ROCKET');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('INCOMING', 'OUTGOING');

-- CreateEnum
CREATE TYPE "PaymentRefType" AS ENUM ('SALE', 'BIRD_SALE', 'PURCHASE', 'EXPENSE', 'PAYROLL');

-- CreateEnum
CREATE TYPE "PerformanceCriterion" AS ENUM ('ATTENDANCE_PERFECT', 'EARLY_PROBLEM_REPORT', 'SUGGESTION_IMPLEMENTED', 'ZERO_NEGLIGENT_LOSS', 'ACCURATE_DATA_ENTRY', 'BIOSECURITY_FOLLOWED', 'HELPED_COWORKER', 'EXTRA_TASK_COMPLETED', 'TEAM_TARGET_HIT', 'CONFLICT_RESOLVED', 'FALSIFIED_RECORD', 'NEGLIGENT_LOSS', 'BIOSECURITY_VIOLATION', 'CONCEALED_PROBLEM', 'MISSED_CRITICAL_TASK', 'EQUIPMENT_DAMAGE', 'CONDUCT_ISSUE', 'TEAM_SUPERVISION_FAILURE', 'UNEXCUSED_ABSENCE', 'PATTERN_LATENESS', 'OTHER');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE');

-- CreateEnum
CREATE TYPE "AlertTypes" AS ENUM ('EMPLOYEE', 'BATCH', 'FEED', 'MEDICINE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AlertLevels" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('ACTIVE', 'RESOLVED');

-- CreateEnum
CREATE TYPE "AlertActionTypes" AS ENUM ('PAY', 'REASSIGN', 'MARK_RESOLVED');

-- CreateTable
CREATE TABLE "Profiles" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "address" TEXT,
    "avatar_id" TEXT,
    "role" "UserRole" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employees" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "role" "EmployeeRoleNames" NOT NULL,
    "salary" DECIMAL(10,2) NOT NULL,
    "joining_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rating" DOUBLE PRECISION DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Admins" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customers" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "company" TEXT,
    "rating" DOUBLE PRECISION DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suppliers" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "role" "SupplierRoleNames" NOT NULL,
    "supplies" "SupplierSupplyCategories"[],
    "company" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Doctors" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "specialty" TEXT,
    "position" TEXT,
    "degrees" TEXT[],
    "institution" TEXT,
    "rating" DOUBLE PRECISION DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Doctors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Avatars" (
    "id" TEXT NOT NULL,
    "public_id" TEXT NOT NULL,
    "image_url" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Avatars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Houses" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "HouseType" NOT NULL,
    "number" INTEGER NOT NULL,
    "capacity" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Houses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Batches" (
    "id" TEXT NOT NULL,
    "batch_code" TEXT NOT NULL,
    "breed" "BirdBreeds" NOT NULL,
    "phase" "Phase" NOT NULL DEFAULT 'BROODER',
    "status" "BatchStatus" NOT NULL DEFAULT 'RUNNING',
    "starting_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expected_selling_date" TIMESTAMP(3) NOT NULL,
    "actual_end_date" TIMESTAMP(3),
    "initial_chick_count" INTEGER NOT NULL,
    "init_chicks_avg_wt" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchHouseAllocation" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "from_house_id" TEXT,
    "to_house_id" TEXT,
    "quantity" INTEGER NOT NULL,
    "reason" "AllocationReason" NOT NULL,
    "recorded_by_id" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotency_key" TEXT NOT NULL,

    CONSTRAINT "BatchHouseAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchHouseBalance" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "house_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BatchHouseBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MortalityLog" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "house_id" TEXT NOT NULL,
    "count_died" INTEGER NOT NULL,
    "cause_note" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "recorded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotency_key" TEXT NOT NULL,

    CONSTRAINT "MortalityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_key" TEXT NOT NULL,
    "category" "ResourceCategories" NOT NULL,
    "unit" "Units" NOT NULL,
    "meta_data" JSONB,
    "reorder_level" DECIMAL(10,3),
    "preferred_reorder_qty" DECIMAL(10,3),
    "lead_time_days" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "supplier_id" TEXT,
    "invoice_no" TEXT,
    "purchase_date" TIMESTAMP(3) NOT NULL,
    "total_amount" DECIMAL(10,2) NOT NULL,
    "paid_amount" DECIMAL(10,2) NOT NULL,
    "due_amount" DECIMAL(10,2) NOT NULL,
    "recorded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseItem" (
    "id" TEXT NOT NULL,
    "purchase_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "batch_id" TEXT,
    "quantity" DECIMAL(10,3) NOT NULL,
    "unit" "Units" NOT NULL,
    "unit_price" DECIMAL(10,2) NOT NULL,
    "total_price" DECIMAL(10,2) NOT NULL,
    "mfg_date" TIMESTAMP(3),
    "expiration_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockUnit" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "purchase_item_id" TEXT,
    "status" "StockUnitStatus" NOT NULL DEFAULT 'UNASSIGNED',
    "initial_quantity" DECIMAL(10,3),
    "remaining_quantity" DECIMAL(10,3),
    "house_id" TEXT,
    "bound_by_id" TEXT,
    "bound_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "stock_unit_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purchase_cost" DECIMAL(10,2) NOT NULL,
    "purchase_date" TIMESTAMP(3) NOT NULL,
    "useful_life_batches" INTEGER NOT NULL,
    "status" "AssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetDepreciation" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetDepreciation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consumption" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT,
    "house_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "stock_unit_id" TEXT,
    "quantity" DECIMAL(10,3) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "recorded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotency_key" TEXT NOT NULL,

    CONSTRAINT "Consumption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Medications" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "consumption_id" TEXT,
    "medicine_name" TEXT NOT NULL,
    "dosage" TEXT NOT NULL,
    "cause" TEXT,
    "period" TEXT,
    "administered_by_id" TEXT NOT NULL,
    "doctor_id" TEXT,
    "remarks" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotency_key" TEXT NOT NULL,

    CONSTRAINT "Medications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vaccinations" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "consumption_id" TEXT,
    "vaccine_name" TEXT NOT NULL,
    "dosage" INTEGER NOT NULL,
    "cause" TEXT,
    "period" TEXT,
    "administered_by_id" TEXT NOT NULL,
    "doctor_id" TEXT,
    "remarks" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotency_key" TEXT NOT NULL,

    CONSTRAINT "Vaccinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnvironmentRecords" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "house_id" TEXT NOT NULL,
    "temperature_c" DOUBLE PRECISION NOT NULL,
    "humidity_percent" DOUBLE PRECISION NOT NULL,
    "ammonia_ppm" DOUBLE PRECISION NOT NULL,
    "co2_ppm" DOUBLE PRECISION NOT NULL,
    "air_pressure_hpa" DOUBLE PRECISION NOT NULL,
    "time_period" "TimePeriods" NOT NULL,
    "recorded_by_id" TEXT NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotency_key" TEXT NOT NULL,

    CONSTRAINT "EnvironmentRecords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeightRecords" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT,
    "house_id" TEXT NOT NULL,
    "average_wt_grams" DECIMAL(10,2) NOT NULL,
    "sample_size" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "measured_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotency_key" TEXT NOT NULL,

    CONSTRAINT "WeightRecords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchFeedingProgram" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "feed_type" "FeedType" NOT NULL,
    "item_id" TEXT NOT NULL,
    "start_day" INTEGER NOT NULL,
    "end_day" INTEGER,

    CONSTRAINT "BatchFeedingProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLedger" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "direction" "StockDirection" NOT NULL,
    "reason" "StockReason" NOT NULL,
    "unit_cost" DECIMAL(10,2),
    "location_type" "LocationType",
    "location_id" TEXT,
    "ref_type" "RefType" NOT NULL,
    "ref_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryAdjustment" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "warehouse_id" TEXT,
    "house_id" TEXT,
    "quantity_before" DECIMAL(10,3) NOT NULL,
    "quantity_after" DECIMAL(10,3) NOT NULL,
    "adjustment_quantity" DECIMAL(10,3) NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "recorded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotency_key" TEXT NOT NULL,

    CONSTRAINT "InventoryAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouses" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "label_name" TEXT NOT NULL,
    "normalized_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemOrganization" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "role" "OrganizationRole" NOT NULL,

    CONSTRAINT "ItemOrganization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT,
    "sale_date" TIMESTAMP(3) NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,
    "paid_amount" DECIMAL(10,2) NOT NULL,
    "due_amount" DECIMAL(10,2) NOT NULL,
    "recorded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleItem" (
    "id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "unit" "Units" NOT NULL,
    "unit_price" DECIMAL(10,2) NOT NULL,
    "total_price" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "SaleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BirdSale" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "sale_date" TIMESTAMP(3) NOT NULL,
    "grade" "BirdGrade" NOT NULL,
    "male_count" INTEGER,
    "female_count" INTEGER,
    "birds_count" INTEGER NOT NULL,
    "dholta_in_g" DECIMAL(10,2) NOT NULL,
    "total_katha" INTEGER NOT NULL,
    "avg_wt_per_katha_kg" DECIMAL(10,2),
    "total_weight" DECIMAL(10,2) NOT NULL,
    "net_weight" DECIMAL(10,2) NOT NULL,
    "avg_weight_g" DECIMAL(10,2),
    "price_per_kg" DECIMAL(10,2) NOT NULL,
    "total_amount" DECIMAL(10,2) NOT NULL,
    "paid_amount" DECIMAL(10,2) NOT NULL,
    "due_amount" DECIMAL(10,2) NOT NULL,
    "recorded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BirdSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT,
    "category" "ExpenseCategory" NOT NULL,
    "cost_type" "CostType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "remarks" TEXT,
    "recorded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "payment_date" TIMESTAMP(3) NOT NULL,
    "direction" "PaymentType" NOT NULL,
    "ref_type" "PaymentRefType" NOT NULL,
    "ref_id" TEXT NOT NULL,
    "from_instrument_id" TEXT NOT NULL,
    "to_instrument_id" TEXT,
    "transaction_ref" TEXT,
    "handled_by_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentInstrument" (
    "id" TEXT NOT NULL,
    "owner_type" "UserRole" NOT NULL,
    "owner_id" TEXT NOT NULL,
    "type" "PaymentMethod" NOT NULL,
    "label" TEXT NOT NULL,
    "bank_name" TEXT,
    "account_no" TEXT,
    "mobile_no" TEXT,
    "mfs_type" "MfsType",
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentInstrument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceScoreEntry" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "given_by_id" TEXT NOT NULL,
    "criterion" "PerformanceCriterion" NOT NULL,
    "points" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotency_key" TEXT NOT NULL,

    CONSTRAINT "PerformanceScoreEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRecord" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "baseline_salary" DECIMAL(10,2) NOT NULL,
    "score_sum" INTEGER NOT NULL,
    "adjustment_percent" DECIMAL(5,2) NOT NULL,
    "final_salary" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "table_name" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "changed_by_id" TEXT NOT NULL,
    "before_data" JSONB,
    "after_data" JSONB,
    "note" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alerts" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "AlertTypes" NOT NULL,
    "level" "AlertLevels" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'ACTIVE',
    "related_id" TEXT,
    "action_type" "AlertActionTypes",
    "issued_at" DATE,
    "resolved_at" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ItemToSuppliers" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ItemToSuppliers_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Profiles_email_key" ON "Profiles"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Profiles_mobile_key" ON "Profiles"("mobile");

-- CreateIndex
CREATE INDEX "Profiles_role_idx" ON "Profiles"("role");

-- CreateIndex
CREATE UNIQUE INDEX "Employees_profile_id_key" ON "Employees"("profile_id");

-- CreateIndex
CREATE INDEX "Employees_role_idx" ON "Employees"("role");

-- CreateIndex
CREATE UNIQUE INDEX "Admins_profile_id_key" ON "Admins"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "Customers_profile_id_key" ON "Customers"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "Suppliers_profile_id_key" ON "Suppliers"("profile_id");

-- CreateIndex
CREATE INDEX "Suppliers_supplies_idx" ON "Suppliers"("supplies");

-- CreateIndex
CREATE UNIQUE INDEX "Doctors_profile_id_key" ON "Doctors"("profile_id");

-- CreateIndex
CREATE INDEX "Houses_type_idx" ON "Houses"("type");

-- CreateIndex
CREATE UNIQUE INDEX "Batches_batch_code_key" ON "Batches"("batch_code");

-- CreateIndex
CREATE INDEX "Batches_status_idx" ON "Batches"("status");

-- CreateIndex
CREATE UNIQUE INDEX "BatchHouseAllocation_idempotency_key_key" ON "BatchHouseAllocation"("idempotency_key");

-- CreateIndex
CREATE INDEX "BatchHouseAllocation_batch_id_idx" ON "BatchHouseAllocation"("batch_id");

-- CreateIndex
CREATE INDEX "BatchHouseAllocation_from_house_id_idx" ON "BatchHouseAllocation"("from_house_id");

-- CreateIndex
CREATE INDEX "BatchHouseAllocation_to_house_id_idx" ON "BatchHouseAllocation"("to_house_id");

-- CreateIndex
CREATE INDEX "BatchHouseBalance_house_id_idx" ON "BatchHouseBalance"("house_id");

-- CreateIndex
CREATE UNIQUE INDEX "BatchHouseBalance_batch_id_house_id_key" ON "BatchHouseBalance"("batch_id", "house_id");

-- CreateIndex
CREATE UNIQUE INDEX "MortalityLog_idempotency_key_key" ON "MortalityLog"("idempotency_key");

-- CreateIndex
CREATE INDEX "MortalityLog_batch_id_idx" ON "MortalityLog"("batch_id");

-- CreateIndex
CREATE INDEX "MortalityLog_house_id_date_idx" ON "MortalityLog"("house_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Item_normalized_key_key" ON "Item"("normalized_key");

-- CreateIndex
CREATE INDEX "Item_category_idx" ON "Item"("category");

-- CreateIndex
CREATE INDEX "Purchase_supplier_id_purchase_date_idx" ON "Purchase"("supplier_id", "purchase_date");

-- CreateIndex
CREATE INDEX "PurchaseItem_item_id_idx" ON "PurchaseItem"("item_id");

-- CreateIndex
CREATE INDEX "PurchaseItem_batch_id_idx" ON "PurchaseItem"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "StockUnit_code_key" ON "StockUnit"("code");

-- CreateIndex
CREATE INDEX "StockUnit_purchase_item_id_idx" ON "StockUnit"("purchase_item_id");

-- CreateIndex
CREATE INDEX "StockUnit_status_idx" ON "StockUnit"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_stock_unit_id_key" ON "Asset"("stock_unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "AssetDepreciation_asset_id_batch_id_key" ON "AssetDepreciation"("asset_id", "batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "Consumption_idempotency_key_key" ON "Consumption"("idempotency_key");

-- CreateIndex
CREATE INDEX "Consumption_batch_id_idx" ON "Consumption"("batch_id");

-- CreateIndex
CREATE INDEX "Consumption_house_id_date_idx" ON "Consumption"("house_id", "date");

-- CreateIndex
CREATE INDEX "Consumption_stock_unit_id_idx" ON "Consumption"("stock_unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "Medications_idempotency_key_key" ON "Medications"("idempotency_key");

-- CreateIndex
CREATE INDEX "Medications_batch_id_idx" ON "Medications"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "Vaccinations_idempotency_key_key" ON "Vaccinations"("idempotency_key");

-- CreateIndex
CREATE INDEX "Vaccinations_batch_id_idx" ON "Vaccinations"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "EnvironmentRecords_idempotency_key_key" ON "EnvironmentRecords"("idempotency_key");

-- CreateIndex
CREATE INDEX "EnvironmentRecords_batch_id_idx" ON "EnvironmentRecords"("batch_id");

-- CreateIndex
CREATE INDEX "EnvironmentRecords_house_id_recorded_at_idx" ON "EnvironmentRecords"("house_id", "recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "WeightRecords_idempotency_key_key" ON "WeightRecords"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "WeightRecords_batch_id_house_id_date_key" ON "WeightRecords"("batch_id", "house_id", "date");

-- CreateIndex
CREATE INDEX "BatchFeedingProgram_batch_id_start_day_end_day_idx" ON "BatchFeedingProgram"("batch_id", "start_day", "end_day");

-- CreateIndex
CREATE UNIQUE INDEX "StockLedger_idempotency_key_key" ON "StockLedger"("idempotency_key");

-- CreateIndex
CREATE INDEX "StockLedger_item_id_occurred_at_idx" ON "StockLedger"("item_id", "occurred_at");

-- CreateIndex
CREATE INDEX "StockLedger_ref_type_ref_id_idx" ON "StockLedger"("ref_type", "ref_id");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryAdjustment_idempotency_key_key" ON "InventoryAdjustment"("idempotency_key");

-- CreateIndex
CREATE INDEX "InventoryAdjustment_item_id_idx" ON "InventoryAdjustment"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_normalized_key_key" ON "Organization"("normalized_key");

-- CreateIndex
CREATE UNIQUE INDEX "ItemOrganization_item_id_organization_id_role_key" ON "ItemOrganization"("item_id", "organization_id", "role");

-- CreateIndex
CREATE INDEX "SaleItem_sale_id_idx" ON "SaleItem"("sale_id");

-- CreateIndex
CREATE INDEX "SaleItem_item_id_idx" ON "SaleItem"("item_id");

-- CreateIndex
CREATE INDEX "BirdSale_batch_id_sale_date_idx" ON "BirdSale"("batch_id", "sale_date");

-- CreateIndex
CREATE INDEX "Expense_batch_id_date_idx" ON "Expense"("batch_id", "date");

-- CreateIndex
CREATE INDEX "Expense_cost_type_idx" ON "Expense"("cost_type");

-- CreateIndex
CREATE INDEX "Payment_ref_type_ref_id_idx" ON "Payment"("ref_type", "ref_id");

-- CreateIndex
CREATE UNIQUE INDEX "PerformanceScoreEntry_idempotency_key_key" ON "PerformanceScoreEntry"("idempotency_key");

-- CreateIndex
CREATE INDEX "PerformanceScoreEntry_employee_id_date_idx" ON "PerformanceScoreEntry"("employee_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRecord_employee_id_month_key" ON "PayrollRecord"("employee_id", "month");

-- CreateIndex
CREATE INDEX "AuditLog_table_name_record_id_idx" ON "AuditLog"("table_name", "record_id");

-- CreateIndex
CREATE INDEX "AuditLog_changed_by_id_idx" ON "AuditLog"("changed_by_id");

-- CreateIndex
CREATE INDEX "_ItemToSuppliers_B_index" ON "_ItemToSuppliers"("B");

-- AddForeignKey
ALTER TABLE "Profiles" ADD CONSTRAINT "Profiles_avatar_id_fkey" FOREIGN KEY ("avatar_id") REFERENCES "Avatars"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employees" ADD CONSTRAINT "Employees_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "Profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admins" ADD CONSTRAINT "Admins_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "Profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customers" ADD CONSTRAINT "Customers_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "Profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suppliers" ADD CONSTRAINT "Suppliers_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "Profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Doctors" ADD CONSTRAINT "Doctors_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "Profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchHouseAllocation" ADD CONSTRAINT "BatchHouseAllocation_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "Batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchHouseAllocation" ADD CONSTRAINT "BatchHouseAllocation_from_house_id_fkey" FOREIGN KEY ("from_house_id") REFERENCES "Houses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchHouseAllocation" ADD CONSTRAINT "BatchHouseAllocation_to_house_id_fkey" FOREIGN KEY ("to_house_id") REFERENCES "Houses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchHouseAllocation" ADD CONSTRAINT "BatchHouseAllocation_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "Profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchHouseBalance" ADD CONSTRAINT "BatchHouseBalance_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "Batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchHouseBalance" ADD CONSTRAINT "BatchHouseBalance_house_id_fkey" FOREIGN KEY ("house_id") REFERENCES "Houses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MortalityLog" ADD CONSTRAINT "MortalityLog_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "Batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MortalityLog" ADD CONSTRAINT "MortalityLog_house_id_fkey" FOREIGN KEY ("house_id") REFERENCES "Houses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MortalityLog" ADD CONSTRAINT "MortalityLog_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "Profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "Suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "Profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "Batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockUnit" ADD CONSTRAINT "StockUnit_purchase_item_id_fkey" FOREIGN KEY ("purchase_item_id") REFERENCES "PurchaseItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockUnit" ADD CONSTRAINT "StockUnit_house_id_fkey" FOREIGN KEY ("house_id") REFERENCES "Houses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockUnit" ADD CONSTRAINT "StockUnit_bound_by_id_fkey" FOREIGN KEY ("bound_by_id") REFERENCES "Profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_stock_unit_id_fkey" FOREIGN KEY ("stock_unit_id") REFERENCES "StockUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetDepreciation" ADD CONSTRAINT "AssetDepreciation_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetDepreciation" ADD CONSTRAINT "AssetDepreciation_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "Batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consumption" ADD CONSTRAINT "Consumption_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "Batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consumption" ADD CONSTRAINT "Consumption_house_id_fkey" FOREIGN KEY ("house_id") REFERENCES "Houses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consumption" ADD CONSTRAINT "Consumption_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consumption" ADD CONSTRAINT "Consumption_stock_unit_id_fkey" FOREIGN KEY ("stock_unit_id") REFERENCES "StockUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consumption" ADD CONSTRAINT "Consumption_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "Profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Medications" ADD CONSTRAINT "Medications_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "Batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Medications" ADD CONSTRAINT "Medications_consumption_id_fkey" FOREIGN KEY ("consumption_id") REFERENCES "Consumption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Medications" ADD CONSTRAINT "Medications_administered_by_id_fkey" FOREIGN KEY ("administered_by_id") REFERENCES "Profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Medications" ADD CONSTRAINT "Medications_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "Doctors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vaccinations" ADD CONSTRAINT "Vaccinations_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "Batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vaccinations" ADD CONSTRAINT "Vaccinations_consumption_id_fkey" FOREIGN KEY ("consumption_id") REFERENCES "Consumption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vaccinations" ADD CONSTRAINT "Vaccinations_administered_by_id_fkey" FOREIGN KEY ("administered_by_id") REFERENCES "Profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vaccinations" ADD CONSTRAINT "Vaccinations_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "Doctors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvironmentRecords" ADD CONSTRAINT "EnvironmentRecords_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "Batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvironmentRecords" ADD CONSTRAINT "EnvironmentRecords_house_id_fkey" FOREIGN KEY ("house_id") REFERENCES "Houses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvironmentRecords" ADD CONSTRAINT "EnvironmentRecords_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "Profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeightRecords" ADD CONSTRAINT "WeightRecords_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "Batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeightRecords" ADD CONSTRAINT "WeightRecords_house_id_fkey" FOREIGN KEY ("house_id") REFERENCES "Houses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeightRecords" ADD CONSTRAINT "WeightRecords_measured_by_id_fkey" FOREIGN KEY ("measured_by_id") REFERENCES "Profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchFeedingProgram" ADD CONSTRAINT "BatchFeedingProgram_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "Batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchFeedingProgram" ADD CONSTRAINT "BatchFeedingProgram_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLedger" ADD CONSTRAINT "StockLedger_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "Warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_house_id_fkey" FOREIGN KEY ("house_id") REFERENCES "Houses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "Profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemOrganization" ADD CONSTRAINT "ItemOrganization_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemOrganization" ADD CONSTRAINT "ItemOrganization_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "Customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "Profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirdSale" ADD CONSTRAINT "BirdSale_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "Batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirdSale" ADD CONSTRAINT "BirdSale_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "Customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirdSale" ADD CONSTRAINT "BirdSale_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "Profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "Batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "Profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_from_instrument_id_fkey" FOREIGN KEY ("from_instrument_id") REFERENCES "PaymentInstrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_to_instrument_id_fkey" FOREIGN KEY ("to_instrument_id") REFERENCES "PaymentInstrument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_handled_by_id_fkey" FOREIGN KEY ("handled_by_id") REFERENCES "Profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceScoreEntry" ADD CONSTRAINT "PerformanceScoreEntry_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceScoreEntry" ADD CONSTRAINT "PerformanceScoreEntry_given_by_id_fkey" FOREIGN KEY ("given_by_id") REFERENCES "Profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRecord" ADD CONSTRAINT "PayrollRecord_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "Profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ItemToSuppliers" ADD CONSTRAINT "_ItemToSuppliers_A_fkey" FOREIGN KEY ("A") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ItemToSuppliers" ADD CONSTRAINT "_ItemToSuppliers_B_fkey" FOREIGN KEY ("B") REFERENCES "Suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
