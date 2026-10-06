-- One ACTIVE alert per *condition*, not per (type, related_id): an employee can be both "payroll not
-- generated" and "negative performance" at once, and the old key let whichever the scan raised first
-- hide the other (its checks run in parallel, so which one won was random).
ALTER TABLE "Alerts" ADD COLUMN "dedupe_key" TEXT;

-- Give the alerts that are active now the keys the scan will compute for them, so the next scan
-- finds them instead of raising duplicates. Pattern-matched on the titles the scan generates; if a
-- condition somehow already has several, only the oldest takes the key and the rest stay as plain
-- active alerts for someone to resolve.
WITH keyed AS (
  SELECT id, created_at,
    CASE
      WHEN title LIKE '% is below reorder level' THEN 'LOW_STOCK:' || related_id
      WHEN title LIKE '% mortality rate % in the last 24h' THEN 'MORTALITY:' || related_id
      WHEN title LIKE '% lot expires %' THEN 'EXPIRY:' || related_id
      WHEN title LIKE 'Payroll not yet generated for %' THEN 'PAYROLL_DUE:' || related_id
      WHEN title LIKE '% has a negative performance pattern this month' THEN 'NEG_PERF:' || related_id
      WHEN title LIKE '%probation ended -- confirm or terminate' OR title LIKE '%probation ends soon' THEN 'PROBATION:' || related_id
      WHEN title LIKE '%hasn''t been paid' OR title LIKE '%payout is still %' THEN 'PAYOUT_DUE:' || related_id
    END AS k
  FROM "Alerts"
  WHERE status = 'ACTIVE' AND related_id IS NOT NULL
), ranked AS (
  SELECT id, k, row_number() OVER (PARTITION BY k ORDER BY created_at, id) AS rn
  FROM keyed WHERE k IS NOT NULL
)
UPDATE "Alerts" a SET dedupe_key = r.k FROM ranked r WHERE a.id = r.id AND r.rn = 1;

CREATE UNIQUE INDEX "Alerts_one_active_per_condition" ON "Alerts"("dedupe_key") WHERE (status = 'ACTIVE');
CREATE INDEX "Alerts_status_created_at_idx" ON "Alerts"("status", "created_at");
