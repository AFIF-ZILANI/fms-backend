-- A house can't hold fewer than zero birds. The services decrement with a conditional
-- UPDATE (quantity >= n); this is the backstop for any future writer that doesn't.
-- Prisma can't express a CHECK, so it lives here.
ALTER TABLE "BatchHouseBalance"
  ADD CONSTRAINT "BatchHouseBalance_quantity_nonneg" CHECK ("quantity" >= 0);
