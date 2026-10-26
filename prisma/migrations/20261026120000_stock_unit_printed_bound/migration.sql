-- IN_STOCK -> BOUND keeps every existing bound unit's value (rename, not drop/recreate).
ALTER TYPE "StockUnitStatus" RENAME VALUE 'IN_STOCK' TO 'BOUND';

-- New step between provision and bind. Existing UNASSIGNED codes stay UNASSIGNED.
ALTER TYPE "StockUnitStatus" ADD VALUE 'PRINTED' AFTER 'UNASSIGNED';
