-- A payment INTO the farm from a customer has no instrument of ours to leave, so the source can't be
-- required: it was forcing people to invent one (and, with cash position summed across instruments,
-- could make money received look like money lost). from_instrument becomes optional.
--
-- Existing rows all have a source, so both checks hold on the data already here:
--   * a payment names at least one instrument
--   * an OUTGOING payment always names where the money came from
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_to_instrument_id_fkey";
ALTER TABLE "Payment" ALTER COLUMN "from_instrument_id" DROP NOT NULL;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_to_instrument_id_fkey" FOREIGN KEY ("to_instrument_id") REFERENCES "PaymentInstrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_has_an_instrument"
  CHECK (from_instrument_id IS NOT NULL OR to_instrument_id IS NOT NULL);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_outgoing_has_source"
  CHECK (direction <> 'OUTGOING' OR from_instrument_id IS NOT NULL);
