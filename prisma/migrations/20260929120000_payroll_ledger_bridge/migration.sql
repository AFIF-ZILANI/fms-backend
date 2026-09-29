-- Payroll reached neither money book: no Expense row, so the dashboard's cost
-- total omitted every wage, and no Payment row, so cash_position never dropped
-- when wages left the wallets. See docs/payroll-ledger-bridge.md.
--
-- Additive, so no enum rebuild. Nothing in this migration *uses* the new value
-- (Postgres forbids that until the transaction adding it commits) -- the cash
-- rows for historical payouts are deliberately not backfilled, because nobody
-- recorded which instrument those transfers left and inventing one would put
-- real outflow on a wallet that may never have sent it.
ALTER TYPE "PaymentRefType" ADD VALUE 'PAYROLL';

-- The wage expense category, created here so the backfill below has something
-- to reference. Same row the service upserts on first use.
INSERT INTO "ExpenseCategoryLookup" ("id", "code", "label", "is_active", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'SALARY', 'Salary', true, NOW(), NOW())
ON CONFLICT ("code") DO NOTHING;

-- Cost-side backfill for payouts confirmed before the bridge existed. Dated
-- paid_at and attributed to the payer where one was recorded, else the oldest
-- admin -- the same fallback getActorId uses. Skips any payout already carrying
-- one, so this is safe if it ever runs against a partially bridged database.
INSERT INTO "Expense" ("id", "category", "cost_type", "amount", "date", "remarks", "recorded_by_id", "created_at")
SELECT
    gen_random_uuid(),
    'SALARY',
    'SHARED_PERIOD'::"CostType",
    p."amount",
    p."paid_at",
    'Wage on payout ' || p."id" || ' -- backfilled, see docs/payroll-ledger-bridge.md',
    COALESCE(p."paid_by_id", (SELECT a."profile_id" FROM "Admins" a ORDER BY a."created_at" ASC LIMIT 1)),
    NOW()
FROM "PayrollPayout" p
WHERE p."status" = 'CONFIRMED'
  AND p."paid_at" IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM "Expense" e WHERE e."category" = 'SALARY' AND e."remarks" LIKE '%' || p."id" || '%'
  )
  -- No admin, no attribution, no row: recorded_by_id is NOT NULL.
  AND EXISTS (SELECT 1 FROM "Admins");
