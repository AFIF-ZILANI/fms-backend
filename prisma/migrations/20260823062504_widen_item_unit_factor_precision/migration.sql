-- Decimal(10,4) tops out at 999999.9999 -- too narrow now that Gram-based fixed factors
-- like Metric Ton (1,000,000) exist. Widen to match Unit.fixed_factor's Decimal(14,4).
ALTER TABLE "ItemUnit" ALTER COLUMN "factor_to_base" TYPE DECIMAL(14,4);
