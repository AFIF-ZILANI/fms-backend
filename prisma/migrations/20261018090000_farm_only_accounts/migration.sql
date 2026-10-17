-- Payment accounts are the farm's own. Refuse to run while a customer/supplier/employee account still
-- exists: its payments would need a farm account decided by a person, not by a migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "PaymentInstrument" WHERE "owner_type" <> 'ADMIN') THEN
    RAISE EXCEPTION 'Non-farm payment accounts exist -- move or remove their payments first';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "Payment"
    WHERE NOT (("direction" = 'INCOMING' AND "to_instrument_id" IS NOT NULL AND "from_instrument_id" IS NULL)
            OR ("direction" = 'OUTGOING' AND "from_instrument_id" IS NOT NULL AND "to_instrument_id" IS NULL))
  ) THEN
    RAISE EXCEPTION 'Payments name an account on the wrong side, or two accounts -- fix them first';
  END IF;
END $$;

ALTER TABLE "PaymentInstrument" DROP COLUMN "owner_type", DROP COLUMN "owner_id";

-- One farm account per payment, on the side the money moved. Replaces the two looser checks.
ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_has_an_instrument";
ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_outgoing_has_source";
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_one_farm_account" CHECK (
  ("direction" = 'INCOMING' AND "to_instrument_id" IS NOT NULL AND "from_instrument_id" IS NULL)
  OR ("direction" = 'OUTGOING' AND "from_instrument_id" IS NOT NULL AND "to_instrument_id" IS NULL)
);
