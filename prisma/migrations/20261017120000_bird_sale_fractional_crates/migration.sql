-- A part-filled last crate can be recorded as-is instead of being rounded to a whole crate.
ALTER TABLE "BirdSale" ALTER COLUMN "total_katha" SET DATA TYPE DECIMAL(10,2);
