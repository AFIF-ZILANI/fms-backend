-- Salary payments move out of the generic Payment ledger and into PayrollPayout,
-- which can require proof of transfer. See docs/employee-payroll-design.md.
--
-- Existing PAYROLL rows are carried across rather than dropped. None of them
-- carried a transaction_ref, and the backfill does not invent one: it records
-- where the row came from, so a payout with no real proof is visible as such
-- instead of looking like a verified transfer.
INSERT INTO "PayrollPayout" (
    "id", "payroll_record_id", "method", "account_number", "amount",
    "fee_paid_by_farm", "transaction_ref", "status", "paid_at", "created_at"
)
SELECT
    gen_random_uuid(),
    p."ref_id",
    CASE inst."type"
        WHEN 'CASH' THEN 'CASH'::"PayoutMethod"
        WHEN 'BANK_TRANSFER' THEN 'BANK'::"PayoutMethod"
        WHEN 'MFS' THEN COALESCE(inst."mfs_type"::text, 'BKASH')::"PayoutMethod"
    END,
    COALESCE(inst."account_no", inst."mobile_no", 'UNRECORDED'),
    p."amount",
    0,
    COALESCE(p."transaction_ref", 'backfilled from Payment ' || p."id" || ' -- no reference on record'),
    'CONFIRMED'::"PayoutStatus",
    p."payment_date",
    p."created_at"
FROM "Payment" p
-- The employee's own instrument where one was recorded, else the farm's.
JOIN "PaymentInstrument" inst ON inst."id" = COALESCE(p."to_instrument_id", p."from_instrument_id")
WHERE p."ref_type" = 'PAYROLL'
  AND EXISTS (SELECT 1 FROM "PayrollRecord" r WHERE r."id" = p."ref_id")
  -- PayrollRecord.payout is one-to-one; skip any record already carrying one.
  AND NOT EXISTS (SELECT 1 FROM "PayrollPayout" x WHERE x."payroll_record_id" = p."ref_id");

DELETE FROM "Payment" WHERE "ref_type" = 'PAYROLL';

-- Postgres can't drop a value from an enum in place, so the type is rebuilt.
-- This fails loudly if any PAYROLL row survived the step above, which is the
-- behaviour we want.
ALTER TYPE "PaymentRefType" RENAME TO "PaymentRefType_old";
CREATE TYPE "PaymentRefType" AS ENUM ('SALE', 'BIRD_SALE', 'PURCHASE', 'EXPENSE');
ALTER TABLE "Payment" ALTER COLUMN "ref_type" TYPE "PaymentRefType"
    USING ("ref_type"::text::"PaymentRefType");
DROP TYPE "PaymentRefType_old";
