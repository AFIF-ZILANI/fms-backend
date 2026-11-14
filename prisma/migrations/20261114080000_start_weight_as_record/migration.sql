-- The chicks' start weight is no longer a Batches column: it is the batch's Day-1 WeightRecord
-- (written at batch creation), so the growth curve starts from it like any other sample.

-- One record per batch, in the house the chicks were first placed in, on the placement farm day
-- (same shift as lib/farm-day.ts farmDay: +6h Dhaka, minus the farm's day-start hour).
-- sample_size = chick count: the delivery weight is the whole lot divided by its count.
-- A batch that already has a sample that day in that house can't take a second one (DO NOTHING);
-- the check below then aborts the migration rather than lose its start weight.
INSERT INTO "WeightRecords" ("id", "batch_id", "house_id", "average_wt_grams", "sample_size", "date", "measured_by_id", "idempotency_key")
SELECT gen_random_uuid(), b."id", a."to_house_id", b."init_chicks_avg_wt", b."initial_chick_count",
       (b."starting_date" + make_interval(hours => 6 - COALESCE((SELECT "day_start_hour" FROM "FarmSettings" LIMIT 1), 0)))::date,
       a."recorded_by_id", 'start-weight-' || b."id"
FROM "Batches" b
JOIN LATERAL (
    SELECT "to_house_id", "recorded_by_id" FROM "BatchHouseAllocation"
    WHERE "batch_id" = b."id" AND "reason" = 'INITIAL' AND "to_house_id" IS NOT NULL
    ORDER BY "occurred_at" LIMIT 1
) a ON true
ON CONFLICT DO NOTHING;

-- Never drop the column unless every batch's value now lives in a linked record with the same value,
-- on the placement day. Anything else aborts the whole migration (it runs in one transaction), so
-- nothing is lost: fix the batch named in the error and re-run.
DO $$
DECLARE bad text;
BEGIN
    SELECT string_agg(b."batch_code", ', ') INTO bad FROM "Batches" b
    WHERE NOT EXISTS (
        SELECT 1 FROM "WeightRecords" w
        WHERE w."batch_id" = b."id" AND w."idempotency_key" = 'start-weight-' || b."id"
          AND w."average_wt_grams" = round(b."init_chicks_avg_wt"::numeric, 2)
          AND w."date" = (b."starting_date" + make_interval(hours => 6 - COALESCE((SELECT "day_start_hour" FROM "FarmSettings" LIMIT 1), 0)))::date
    );
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION 'start weight not backfilled for batch(es): % (no INITIAL allocation, or a sample already exists that day in the first house)', bad;
    END IF;
END $$;

ALTER TABLE "Batches" DROP COLUMN "init_chicks_avg_wt";
