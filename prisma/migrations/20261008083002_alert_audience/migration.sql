-- AlterTable
ALTER TABLE "Alerts" ADD COLUMN     "audience" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Backfill: alerts raised before audiences existed. An empty list is admin-only, so without this
-- every alert already on file would vanish from the field app. Keys name the condition (see
-- alert.service.ts); a null key is an alert a person raised by hand.
UPDATE "Alerts" SET "audience" = ARRAY['WORKER','MANAGER'] WHERE "dedupe_key" LIKE 'MORTALITY:%';
UPDATE "Alerts" SET "audience" = ARRAY['MANAGER']
  WHERE "dedupe_key" LIKE 'LOW_STOCK:%' OR "dedupe_key" LIKE 'EXPIRY:%'
     OR "dedupe_key" LIKE 'NEG_PERF:%' OR "dedupe_key" LIKE 'PROBATION:%'
     OR "dedupe_key" IS NULL;
-- PAYROLL_DUE and PAYOUT_DUE stay admin-only (the empty default).
