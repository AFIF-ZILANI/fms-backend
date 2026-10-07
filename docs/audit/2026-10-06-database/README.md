# Database audit — 2026-10-06
- Date: 2026-10-06
- Commit: server@df7bc95
- Files analyzed: prisma/schema.prisma, prisma/migrations/*/migration.sql (30), src/services/*.ts, src/lib/*.ts, src/routes/*.ts, src/controllers/*.ts, src/validators/*.ts, src/middlewares/require-device.ts, src/App.ts, index.ts; consumers checked in ../web and ../mobile. Per-file lists are in each report's header.

## Overview

This audit reviewed the Prisma schema and all its migrations, plus every Prisma call in `src/`. No `$queryRaw` or `$executeRaw` calls exist. Three parallel reviews (design, performance, security) produced 58 raw findings, which were merged into **51 issues**.

- **Before verification:** 1 critical, 9 high, 20 medium, 21 low.
- **After independent verification:** 1 high, 12 medium, 38 low.
  - **Confirmed:** 34 issues.
  - **Modified:** 16 issues. The fix or severity was corrected.
  - **Rejected:** 1 issue.
- **Downgrades:** most severity drops came from calibrating to a single-farm app. For example, the PII issue SEC-04 dropped to low, because without authentication (SEC-01) every endpoint is open anyway.
- **Biggest problem:** `/api` has no authentication. After that, the most important problems are money and stock correctness bugs: double-pay races, balances trusted from client input, and payments recorded twice.

Where 06-verification.md modified an issue, **follow its "Modifications" section over 05-solutions.md**. It also lists tests that each fix breaks.

## Top 10 fixes (verified, in priority order)

| # | ID | Verified severity | Status | What | Effort |
|---|---|---|---|---|---|
| 1 | [SEC-01](05-solutions.md#sec-01-no-authentication-on-api) | high (critical if reachable off-LAN) | confirmed | `/api` has no auth middleware, and every write is attributed to the oldest admin. **Needs your auth-model decision first.** | L |
| 2 | [DES-02](05-solutions.md#des-02-payroll-markpaid-double-submit) | medium | confirmed | Payroll `markPaid` can double-pay: the status check runs outside the transaction. Fix with a conditional `updateMany` claim. | S |
| 3 | [SEC-03](05-solutions.md#sec-03-payout-create-trusts-body-account_numberamount) | medium | modified | Payout create trusts the `amount`, `account_number` and `method` sent by the client. Take them from server data. One test needs updating. | S |
| 4 | [DES-05](05-solutions.md#des-05-ingest-confirm-can-create-duplicate-birdsales) | medium | modified | Confirming an ingested sale can create duplicate BirdSales. Fix by claiming the row and creating the sale in one transaction. The verifier gave a corrected pre-check query. | S |
| 5 | [DES-13](05-solutions.md#des-13-payment-direction-free-form-payroll-expense-payable-twice) | medium | confirmed | Payment `direction` is set by the client, and a payroll SALARY expense can be paid a second time through `POST /payments`. | M |
| 6 | [DES-10](05-solutions.md#des-10-balance-guards-race-no-non-negative-check-force-close-zeroes-out-of-band) | medium | modified | Bird, stock and payment balance checks race each other. Use conditional updates and an advisory lock in `PaymentService.create`, then add CHECK constraints. Batch force-close also needs `recorded_by_id`. | M |
| 7 | [DES-14](05-solutions.md#des-14-inventoryadjustment-trusts-client-stock-reason-never-maps) | medium | modified | Inventory adjustment computes the change from the client's `quantity_before`, and its reason never reaches the ledger or analytics. Keep "house wins" and handle Opening balance as described in 06. | M |
| 8 | [DES-01](05-solutions.md#des-01-lookup-code-changes-on-rename) | medium | modified | Renaming a Unit or Category regenerates the `code` that the app logic matches on (`FEED`, `SALARY`, `KG`). Freeze the code on rename. Four tests need updating. | S |
| 9 | [DES-11](05-solutions.md#des-11-is_unit_tracked-not-enforced-consumption-item-mismatch) | medium | confirmed | A consumption entry can draw a StockUnit that belongs to a different item. | M |
| 10 | [DES-04](05-solutions.md#des-04-polymorphic-references-unchecked) | medium | modified | A transfer can send stock to a location that doesn't exist. Only part 1 is needed now, and it is one line. | S |

**Also cheap and safe:** one additive index migration covers [PERF-01](05-solutions.md#perf-01-purchaseitempurchase_id-unindexed), [PERF-02](05-solutions.md#perf-02-payment-instrument-fks-unindexed-dashboard-fans-out-per-instrument), [PERF-03](05-solutions.md#perf-03-stockledger-has-no-location_type-location_id-index), [PERF-05](05-solutions.md#perf-05-trend-endpoints-filter-on-date-with-no-usable-index) and [PERF-08](05-solutions.md#perf-08-consumptionitem_id-unindexed). The same migration can drop the indexes nothing uses ([PERF-11](05-solutions.md#perf-11-unused-indexes)).

## Needs my decision

- [SEC-01](05-solutions.md#sec-01-no-authentication-on-api): pick the auth model, a signed cookie (option A, the simplest) or another option. Also decide whether mobile may call any endpoint without logging in. This unblocks SEC-02, SEC-07 and SEC-08.
- [SEC-02](05-solutions.md#sec-02-pairing-codes-mintable-for-any-profile): decide whether device pairing codes are minted only by admins or by employees for themselves.
- [DES-03](05-solutions.md#des-03-due_amount-read-as-live-balance-create-time-paid-has-no-payment): part A (net Payments in the dashboard outstanding figures) is safe now. Part B needs a decision: should an amount paid at create time also write a Payment row?
- [DES-06](05-solutions.md#des-06-item-sales-never-leave-stock): decide whether item Sales should deduct from stock. Today they never write a StockLedger OUT.
- [SEC-07](05-solutions.md#sec-07-fake-or-missing-actor-attribution): decide how actors are attributed until auth exists. The one-line `is_active` filter is safe now.
- [DES-15](05-solutions.md#des-15-soft-delete-is-display-only-hard-deletes-contradict-docs): set the soft-delete versus hard-delete policy. Also decide whether deactivated items can still be purchased, and whether StockUnits with move history can be deleted.
- [SEC-08](05-solutions.md#sec-08-auditlog-barely-written-not-tamper-proof): decide whether to make AuditLog append-only with a trigger. If so, use the `app.allow_audit_purge` escape hatch for tests.
- [SEC-11](05-solutions.md#sec-11-ingest-idempotency-key-is-global): the recommendation is to keep the global idempotency key. Confirm.
- [DES-17](05-solutions.md#des-17-dead-or-misleading-schema-surface): decide whether to drop the dead schema items: `ContactMethods`, `receipt_doc_url` and `Doctors.rating`.
- [DES-21](05-solutions.md#des-21-naming-inconsistencies): decide whether the naming cleanup is worth a release across the server, web and mobile repos. The recommendation is to accept and document it.
- [DES-20](05-solutions.md#des-20-nullability-and-duplicate-value-mismatches), raised in verification: should `Houses.number` be unique farm-wide or per house type?
- [DES-04](05-solutions.md#des-04-polymorphic-references-unchecked) part 2, raised in verification: the FK on `PaymentInstrument.owner_id` was deferred. Confirm.

## Rejected / dropped

- **DES-18** (add `updated_at`/`created_at` to several models): rejected. Nothing reads these columns yet, and `paid_at`, `active_from/active_to` and `status/void_reason` already record what matters. Add the columns when an incremental-sync reader exists.
- **Partially dropped in verification:**
  - DES-19: the `PayrollRecord.month → @db.Date` change. The service already normalizes the month.
  - SEC-10: hashing pairing codes. They are short-lived, single-use codes, so hashing is optional. The rate-limit key fix stays.
  - DES-04: part 2 (deferred).
  - PERF-04: pagination. Replaced with `take` plus a default `PENDING` filter, which avoids an API break.
- **Accepted as-is at this scale (no action):** PERF-12, PERF-13, PERF-14, PERF-15, PERF-18. Revisit them with `pg_stat_*` data.

## Files

- [findings/01-design.md](findings/01-design.md): schema design and integrity (21 raw findings)
- [findings/02-performance.md](findings/02-performance.md): performance and query patterns (22 raw findings)
- [findings/03-security.md](findings/03-security.md): security, plus the auth and tenancy model (15 raw findings)
- [04-issues.md](04-issues.md): the 51 consolidated issues with stable IDs
- [05-solutions.md](05-solutions.md): the fix for each issue, with migration risk, effort, grouping and execution order
- [06-verification.md](06-verification.md): the independent check (confirmed / modified / rejected), with corrected fixes
