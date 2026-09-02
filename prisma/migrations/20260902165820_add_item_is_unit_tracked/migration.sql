-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "is_unit_tracked" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: mark an item unit-tracked if it already has at least one StockUnit bound to one of
-- its purchase lots -- derived from real usage, not a category guess (EQUIPMENT is unit-tracked
-- too, but isn't caught by the one existing MEDICINE/VACCINE-only heuristic elsewhere).
UPDATE "Item"
SET "is_unit_tracked" = true
WHERE "id" IN (
    SELECT DISTINCT "pi"."item_id"
    FROM "PurchaseItem" "pi"
    INNER JOIN "StockUnit" "su" ON "su"."purchase_item_id" = "pi"."id"
);
