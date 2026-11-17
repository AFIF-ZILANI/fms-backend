-- "Fix usage": a Consumption corrected in place keeps who fixed it, when, and why.
ALTER TABLE "Consumption" ADD COLUMN "fixed_at" TIMESTAMP(3),
ADD COLUMN "fixed_by_id" TEXT,
ADD COLUMN "fix_reason" TEXT;

ALTER TABLE "Consumption" ADD CONSTRAINT "Consumption_fixed_by_id_fkey" FOREIGN KEY ("fixed_by_id") REFERENCES "Profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
