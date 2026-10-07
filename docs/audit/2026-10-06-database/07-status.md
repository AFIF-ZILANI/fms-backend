# 07 — Status after the fixes
- Date: 2026-10-07
- Commit: server@main (all fixes merged; each has a test that fails without it)
- Files analyzed: 04-issues.md, 05-solutions.md, 06-verification.md, and the merged changes in server, web and mobile

Outcome of each of the 51 issues. Where the fix differs from 05-solutions.md, the reason is given.

| Outcome | Count |
| --- | --- |
| Fixed | 41 |
| Partly fixed (the rest was deferred by verification) | 2 |
| Accepted as-is (documented, revisit with data) | 7 |
| Needs the owner's decision | 0 |
| Rejected by verification | 1 |
| **Total** | **51** |

## Security
| ID | Outcome | Notes |
| --- | --- | --- |
| SEC-01 | Fixed | Email + password login, default-deny `/api`, cookie (web) and bearer (mobile), role matrix in `lib/permissions.ts`. |
| SEC-02 | Fixed | Pairing codes are admin-only via the role matrix. Whether a phone binds to an admin or an employee is unchanged. |
| SEC-03 | Fixed | Payout destination and amount come from the account on file and the payroll record. |
| SEC-04 | Fixed | The employee roster omits the personal file; the single-employee read keeps it. |
| SEC-05 | Fixed | A score entry's approver must be an admin. |
| SEC-06 | Fixed | An instrument's account number can't be repointed once payments exist. |
| SEC-07 | Fixed | Actor columns for void, acknowledge, revoke, terminate and account close; the oldest-admin fallback skips deactivated admins. |
| SEC-08 | Fixed | Audit log is append-only via a trigger (`audit_log_guard`); purging needs a per-transaction flag, used only by test cleanup. Running the app as a non-owner DB role is still a deploy-time choice. |
| SEC-09 | Fixed | Device list/revoke never return `token_hash`. |
| SEC-10 | Partly fixed | Rate limit keys on the socket address (`TRUST_PROXY` to opt in behind a proxy). Pairing codes are still stored in plaintext: verification rated hashing low value (single-use, 10 minutes). |
| SEC-11 | Accepted | Keep the global ingest idempotency key: it correctly handles a re-paired phone resending. |
| SEC-12 | Fixed | Upload signature is always the `employees` folder. |

## Design
| ID | Outcome | Notes |
| --- | --- | --- |
| DES-01 | Fixed | A rename never changes a lookup's code. |
| DES-02 | Fixed | Confirming a payout claims it inside the transaction; the partial unique on Payment was skipped (the claim alone fixes it). |
| DES-03 | Fixed | Dashboard figures net payments, and an amount paid at creation now writes a Payment row against a named account (paid stored as 0, due = net owed). |
| DES-04 | Part 1 fixed; part 2 deferred | A transfer validates its destination. The FK on `PaymentInstrument.owner_id` was deferred by verification (only a list filter reads it). |
| DES-05 | Fixed | Ingest confirm claims the row and creates the BirdSale in one transaction. |
| DES-06 | Fixed | Item sales require a warehouse and post StockLedger OUT rows, refusing overselling. Unit-tracked items' StockUnit status stays manual. |
| DES-07 | Fixed | `WeightRecords.date` is a farm-local day; partial unique for no-batch weighings. |
| DES-08 | Fixed | Removed employee deactivate/reactivate; terminate/reinstate remain. |
| DES-09 | Fixed | History-bearing FKs restrict deletes. |
| DES-10 | Fixed | Conditional decrements, advisory locks, non-negative CHECK, force-close writes adjustments. |
| DES-11 | Fixed | Coded draw must match the item; tracking mode fixed once purchased. |
| DES-12 | Fixed | 18 CHECKs + one-open-payout-account index. One is `NOT VALID` for a legacy score entry (see README). |
| DES-13 | Fixed | Payment direction derived; wage/bonus expenses can't be paid twice. |
| DES-14 | Fixed | Adjustment "before" is read from the ledger; reasons map to ledger reasons. |
| DES-15 | Fixed | Delete only mistakes; anything with history is refused by the DB. |
| DES-16 | Fixed | Ingest status/portion are enums. |
| DES-17 | Fixed | Dropped `ContactMethods`, `receipt_doc_url`, `Doctors.rating`. The two `Profiles` questions (supplier-and-customer; keep `role`) were left as they are. |
| DES-18 | Rejected | Nothing reads `updated_at`; actor columns and the audit log cover "who". |
| DES-19 | Fixed | Alert times, ledger unit cost. The `PayrollRecord.month` change was dropped by verification. |
| DES-20 | Fixed | Purchase warehouse required; house number unique **per type** (the real houses repeat numbers across types); DIRECT expense needs a batch (`NOT VALID` for two older rows). |
| DES-21 | Accepted | Naming inconsistencies: a rename would touch every repo for no functional gain. |

## Performance
| ID | Outcome | Notes |
| --- | --- | --- |
| PERF-01 | Fixed | Index migration. |
| PERF-02 | Fixed | Indexes + two grouped queries for instrument balances. |
| PERF-03 | Fixed | Index migration. |
| PERF-04 | Fixed | Ingest list defaults to PENDING and is capped; response shape unchanged. |
| PERF-05 | Fixed | Date-leading indexes. |
| PERF-06 | Fixed, differently | Dedupe key per *condition* (not per employee) with a partial unique. The audit's version kept a bug where one alert hid another; it was also the cause of the old flaky alert test. |
| PERF-07 | Fixed | Unfiltered sales summaries skip the id list. |
| PERF-08 | Fixed | Index migration. |
| PERF-09 | Fixed | Ledger list selects only item name/unit. |
| PERF-10 | Fixed | Farm overview counts instead of loading. |
| PERF-11 | Fixed | Three unused indexes dropped. |
| PERF-12 | Accepted | One `last_seen_at` write per device request. |
| PERF-13 | Accepted | Low-volume tables. |
| PERF-14 | Accepted | Deep includes on lists; revisit if a list is measurably slow. |
| PERF-15 | Accepted | Purchases have few lines. |
| PERF-16 | Fixed | Three range reads instead of up to 72 aggregates. |
| PERF-17 | Fixed | Batch close, stock-unit relocate and payroll generate are race-safe. |
| PERF-18 | Accepted | Balances recomputed from the ledger; the indexes keep it index-driven. |

## Added beyond the audit
- Festival bonus (events, proposal, grant, payout) and the `PayrollPayout` → `EmployeePayout` rename.
- Audit-log writes for the sensitive actions (`lib/audit.ts`).
- The real cause of the flaky alert test (see PERF-06).

## Still open
1. **Data tidy-ups** — attach or reclassify the two batchless DIRECT expenses, and void or give a notice to the legacy −4 score entry, then run the two `VALIDATE CONSTRAINT` statements in the migrations.
