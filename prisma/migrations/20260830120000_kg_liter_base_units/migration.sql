-- Promote KG / LITER to the mass & volume base units (were G / ML).
-- Bulk feed (30 metric ton = 30,000 KG) now stays a small, non-overflowing number; G and ML
-- become derived units used for fine dosing. Every durable quantity is stored in Item.unit, so
-- flipping the base means dividing every stored base-unit value in a G/ML item by 1000.
-- Non-destructive: converts existing rows in place (no-op on empty tables). Both mass and volume
-- scale by exactly 1000, so one divisor covers both families.

-- 1. Widen the base-unit-denominated quantity columns. Headroom for bulk feed AND fractional
--    precision (4 dp = 0.1 g / 0.1 mL) so a sub-gram dose in a KG/LITER item isn't truncated.
ALTER TABLE "Item"                ALTER COLUMN "reorder_level"         TYPE DECIMAL(13,4);
ALTER TABLE "Item"                ALTER COLUMN "preferred_reorder_qty" TYPE DECIMAL(13,4);
ALTER TABLE "PurchaseItem"        ALTER COLUMN "base_quantity"         TYPE DECIMAL(13,4);
ALTER TABLE "Consumption"         ALTER COLUMN "base_quantity"         TYPE DECIMAL(13,4);
ALTER TABLE "StockLedger"         ALTER COLUMN "quantity"              TYPE DECIMAL(13,4);
ALTER TABLE "StockUnit"           ALTER COLUMN "initial_quantity"      TYPE DECIMAL(13,4);
ALTER TABLE "StockUnit"           ALTER COLUMN "remaining_quantity"    TYPE DECIMAL(13,4);
ALTER TABLE "InventoryAdjustment" ALTER COLUMN "quantity_before"       TYPE DECIMAL(13,4);
ALTER TABLE "InventoryAdjustment" ALTER COLUMN "quantity_after"        TYPE DECIMAL(13,4);
ALTER TABLE "InventoryAdjustment" ALTER COLUMN "adjustment_quantity"   TYPE DECIMAL(13,4);
ALTER TABLE "StockTransfer"       ALTER COLUMN "base_quantity"         TYPE DECIMAL(13,4);

-- 2. Convert existing per-item conversion rows (keyed on the item's CURRENT base G/ML).
--    A row whose unit is the NEW base is now redundant (unit == Item.unit) -- delete it.
DELETE FROM "ItemUnit" iu USING "Item" i
  WHERE iu.item_id = i.id AND ((i.unit = 'G' AND iu.unit = 'KG') OR (i.unit = 'ML' AND iu.unit = 'LITER'));
--    The rest: 1 unit was N grams/mL of base, now N/1000 kg/L of base.
UPDATE "ItemUnit" iu SET factor_to_base = factor_to_base / 1000
  FROM "Item" i WHERE iu.item_id = i.id AND i.unit IN ('G', 'ML');

-- 3. Divide every stored base-unit quantity for G/ML items by 1000. Money (total_price, unit_price)
--    is untouched; StockLedger.unit_cost is cost-per-base-unit so it scales UP by 1000 (per-kg/per-L).
UPDATE "Item" SET reorder_level = reorder_level / 1000, preferred_reorder_qty = preferred_reorder_qty / 1000
  WHERE unit IN ('G', 'ML');
UPDATE "PurchaseItem" t SET base_quantity = base_quantity / 1000
  FROM "Item" i WHERE t.item_id = i.id AND i.unit IN ('G', 'ML');
UPDATE "Consumption" t SET base_quantity = base_quantity / 1000
  FROM "Item" i WHERE t.item_id = i.id AND i.unit IN ('G', 'ML');
UPDATE "StockLedger" t SET quantity = quantity / 1000, unit_cost = unit_cost * 1000
  FROM "Item" i WHERE t.item_id = i.id AND i.unit IN ('G', 'ML');
UPDATE "InventoryAdjustment" t
  SET quantity_before = quantity_before / 1000, quantity_after = quantity_after / 1000,
      adjustment_quantity = adjustment_quantity / 1000
  FROM "Item" i WHERE t.item_id = i.id AND i.unit IN ('G', 'ML');
UPDATE "StockTransfer" t SET base_quantity = base_quantity / 1000
  FROM "Item" i WHERE t.item_id = i.id AND i.unit IN ('G', 'ML');
-- StockUnit links to an item only through its purchase line.
UPDATE "StockUnit" su
  SET initial_quantity = initial_quantity / 1000, remaining_quantity = remaining_quantity / 1000
  FROM "PurchaseItem" pi JOIN "Item" i ON pi.item_id = i.id
  WHERE su.purchase_item_id = pi.id AND i.unit IN ('G', 'ML');

-- 4. Flip the items themselves onto the new base unit.
UPDATE "Item" SET unit = 'KG'    WHERE unit = 'G';
UPDATE "Item" SET unit = 'LITER' WHERE unit = 'ML';

-- 5. Rebuild the Unit hierarchy. Null KG/LITER's parent FIRST so no row transiently points at a
--    child that's about to become a root.
UPDATE "Unit" SET is_base = true,  base_unit = NULL,    fixed_factor = NULL  WHERE code IN ('KG', 'LITER');
UPDATE "Unit" SET is_base = false, base_unit = 'KG',    fixed_factor = 0.001 WHERE code = 'G';
UPDATE "Unit" SET is_base = false, base_unit = 'LITER', fixed_factor = 0.001 WHERE code = 'ML';
UPDATE "Unit" SET base_unit = 'KG',    fixed_factor = 40   WHERE code = 'MON_40KG';
UPDATE "Unit" SET base_unit = 'KG',    fixed_factor = 1000 WHERE code = 'METRIC_TON';
UPDATE "Unit" SET base_unit = 'KG'                         WHERE code IN ('BAG', 'SACHETS');
UPDATE "Unit" SET base_unit = 'LITER'                      WHERE code IN ('BOTTLE', 'POUCH', 'BARREL');
