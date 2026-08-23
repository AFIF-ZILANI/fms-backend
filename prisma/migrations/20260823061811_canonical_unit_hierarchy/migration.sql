-- AlterTable: Unit gains a base-unit hierarchy (is_base / base_unit / fixed_factor).
ALTER TABLE "Unit" ADD COLUMN "is_base" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Unit" ADD COLUMN "base_unit" TEXT;
ALTER TABLE "Unit" ADD COLUMN "fixed_factor" DECIMAL(14,4);
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_base_unit_fkey" FOREIGN KEY ("base_unit") REFERENCES "Unit"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Wipe every existing Item and everything that references one. Confirmed with the user --
-- every current item (and its purchases/payments/consumption/stock ledger) is dev/test
-- fixture data from before Item.unit was restricted to the 6 canonical base units below;
-- there is no real business data pre-launch. Deleted in FK-safe order, deepest first.
DELETE FROM "BatchFeedingProgram" WHERE item_id IN (SELECT id FROM "Item");
DELETE FROM "Consumption" WHERE item_id IN (SELECT id FROM "Item");
DELETE FROM "StockLedger" WHERE item_id IN (SELECT id FROM "Item");
DELETE FROM "SaleItem" WHERE item_id IN (SELECT id FROM "Item");
DELETE FROM "Payment" WHERE ref_type = 'PURCHASE' AND ref_id IN (SELECT id FROM "Purchase");
DELETE FROM "PurchaseItem" WHERE item_id IN (SELECT id FROM "Item");
DELETE FROM "Purchase";
DELETE FROM "Item"; -- cascades ItemUnit, ItemOrganization, InventoryAdjustment automatically

-- Drop unit codes with no place in the new hierarchy (safe now that nothing references them):
-- BOX/VIAL/OTHER per the user's call, plus "L" -- a dead duplicate of LITER nothing ever used.
DELETE FROM "Unit" WHERE code IN ('BOX', 'VIAL', 'OTHER', 'L');

-- The 6 canonical base units. METER is new; the other 5 already existed.
INSERT INTO "Unit" (id, code, label, is_base, updated_at) VALUES
  (gen_random_uuid(), 'METER', 'Meter', true, now())
ON CONFLICT (code) DO NOTHING;
UPDATE "Unit" SET is_base = true WHERE code IN ('ML', 'G', 'UNIT', 'DOSE', 'PCS');

-- New derived unit codes.
INSERT INTO "Unit" (id, code, label, base_unit, fixed_factor, updated_at) VALUES
  (gen_random_uuid(), 'FT', 'Ft', 'METER', 0.3048, now()),
  (gen_random_uuid(), 'POUCH', 'Pouch', 'ML', NULL, now()),
  (gen_random_uuid(), 'BARREL', 'Barrel', 'ML', NULL, now()),
  (gen_random_uuid(), 'CONTAINER', 'Container', NULL, NULL, now())
ON CONFLICT (code) DO NOTHING;

-- Existing derived unit codes -- backfill family + fixed factors.
UPDATE "Unit" SET base_unit = 'ML', fixed_factor = 1000 WHERE code = 'LITER';
UPDATE "Unit" SET base_unit = 'ML', fixed_factor = NULL WHERE code = 'BOTTLE';
UPDATE "Unit" SET base_unit = 'G', fixed_factor = 1000 WHERE code = 'KG';
UPDATE "Unit" SET base_unit = 'G', fixed_factor = 40000 WHERE code = 'MON_40KG';
UPDATE "Unit" SET base_unit = 'G', fixed_factor = 1000000 WHERE code = 'METRIC_TON';
UPDATE "Unit" SET base_unit = 'G', fixed_factor = NULL WHERE code = 'SACHETS';
UPDATE "Unit" SET base_unit = 'G', fixed_factor = NULL WHERE code = 'BAG';
