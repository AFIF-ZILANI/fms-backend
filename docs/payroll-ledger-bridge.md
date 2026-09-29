# Payroll → Ledger Bridge

Status: **built.** All three decisions were taken as recommended — a required
"Paid from" select, cost-side backfill only, and `SHARED_PERIOD` for wages.

## The hole

FMS keeps money in two independent books, and neither of them knows payroll exists.

| Book               | Written by                                     | Read by                                                                            |
| ------------------ | ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Cost** (accrual) | `Expense`, `PurchaseItem`, `AssetDepreciation` | `financialDashboard.expenses`, `batchPnl`, `expenseBreakdown`, `revenueVsExpenses` |
| **Cash**           | `Payment` → `PaymentInstrument.getBalance`     | `financialDashboard.cash_position`, `cash_by_instrument`                           |

`PayrollPayout` writes to neither. Confirming a payout sets a status, stores a
transaction reference, and stops. Measured against the current database:

- **8 confirmed payouts, ৳98,070** of wages actually transferred.
- **৳5,050** of `Expense` rows in total.
- **0** `Payment` rows referencing payroll.

So `financialDashboard` reports ৳5,050 of expenses in a system that has paid out
৳98,070 in wages — gross profit overstated by roughly the entire payroll — and
`cash_position` is short ৳98,070 of outflow that has genuinely left the wallets.
The cash figure is the more dangerous of the two: it is the number someone reads
before deciding whether they can afford this month's feed.

## What this does _not_ reverse

`employee-payroll-design.md` §"Why PayrollPayout and not the existing Payment"
moved salary out of `Payment` because `Payment` cannot require proof of transfer,
cannot hold an account snapshot, and would need six nullable columns that are
meaningless on a sale. That reasoning is about where a payout is **authored**, and
it still holds. The same section also says, in its last line:

> `Payment` stays the general cash ledger and gets simpler for it.

A general cash ledger with payroll missing from it is not a general cash ledger.
The bridge keeps both halves of that decision: `PayrollPayout` remains the only
way to author a payout and still refuses to confirm without proof, and the ledger
rows are **emitted as a consequence** of confirming — downstream shadows, not an
alternative route to paying someone.

The migration note in that section lists a blocker — `PaymentRefType.PAYROLL` was
retained "because rows already reference it". That is resolved: the backfill in
`20260928174546_retire_payment_payroll_ref` ran, and there are **zero** `PAYROLL`
payments left. Re-adding the value is additive (`ALTER TYPE ... ADD VALUE`), with
no enum rebuild and nothing to migrate.

## Design

On confirm, inside the transaction `markPaid` already opens for the transfer fee,
the payout emits:

**1. The wage, as cost.** One `Expense` per payout:

| Field            | Value                                                           |
| ---------------- | --------------------------------------------------------------- |
| `category`       | `SALARY` (upserted on first use, same as `SALARY_TRANSFER_FEE`) |
| `cost_type`      | `SHARED_PERIOD`                                                 |
| `amount`         | `payout.amount`                                                 |
| `date`           | `paid_at`                                                       |
| `recorded_by_id` | whoever confirmed                                               |

`SHARED_PERIOD` rather than `DIRECT` because `PayrollRecord` carries no
`batch_id` and shed labour spans whatever batches are running that month. The
consequence is explicit: **`batchPnl` still will not show labour**, because
shared-period costs are left unallocated there until the bird-days formula lands
(v2, `system-design-arc.md` §7). Attributing a wage to one batch by guesswork
would be worse than leaving the gap visible.

**2. The transfer, as cash.** One `Payment` per payout:

| Field                 | Value                                                         |
| --------------------- | ------------------------------------------------------------- |
| `direction`           | `OUTGOING`                                                    |
| `amount`              | `payout.amount + payout.fee_paid_by_farm`                     |
| `from_instrument_id`  | the farm instrument the money left — **new input, see below** |
| `ref_type` / `ref_id` | `PAYROLL` / the payout id                                     |
| `transaction_ref`     | the payout's, so the wallet statement reconciles              |

One `Payment`, not two, and referencing the payout rather than the `Expense`
rows: cash left the wallet **once**, as ৳15,005 covering both the wage and the
fee. A `Payment` has a single `ref_id`, so pointing at expenses would force two
rows for one real transfer and the instrument statement would stop lining up with
the bKash statement line. The payout is the event that moved the money, so it is
what the cash row references.

No double-counting: no query sums the cost and cash books together
(`analytics.service.ts` aggregates `Expense` and `Payment` separately, for
different fields).

### What changed

- **Migration** `20260929120000_payroll_ledger_bridge` — `ALTER TYPE ... ADD
  VALUE 'PAYROLL'`, the `SALARY` category, and the cost-side backfill.
- **`payment.validator.ts`** — the ref-type list splits in two. Reads accept
  `PAYROLL`; `createPaymentSchema` does not, so a salary payment still cannot be
  authored through `POST /payments`. That split *is* the original decision, now
  enforced rather than achieved by the value's absence.
- **`owedForRef`** — a `PAYROLL` case returning `amount + fee_paid_by_farm`, so
  the over-payment guard and the outstanding/total-paid endpoints cover payouts.
- **`markPaid`** — emits the two expenses and the payment, and validates that the
  chosen instrument exists and is active.
- **Payout modal** — the "Paid from" select; Confirm stays disabled without it.

`markPaid` will write `tx.payment.create` directly rather than calling
`PaymentService.create`, which opens a transaction of its own. The guard that
call would add is redundant here — a payout can only be confirmed once, so it
cannot be over-paid.

## Decisions taken

**1. The source instrument is chosen, not defaulted.** `from_instrument_id` is
required on `mark-paid` and the modal carries a "Paid from" select listing active
farm instruments (`owner_type = ADMIN`, so customer and supplier wallets are not
offered). A default that is silently wrong corrupts a specific wallet's balance
with no way to tell afterwards.

**2. Cost-side backfill only.** The migration writes a `SALARY` expense for each
of the 8 historical confirmed payouts, dated `paid_at`, attributed to
`paid_by_id` where one exists and otherwise the oldest admin — the same fallback
`getActorId` uses. Verified: expenses went from ৳5,050 to ৳103,120, exactly
৳98,070 more.

Their **cash rows are deliberately absent.** Nobody recorded which wallet those
transfers left, and inventing one would put ৳98,070 of real outflow on a wallet
that may never have sent it. `cash_position` is therefore still ৳98,070 optimistic
for pre-bridge payouts, and closing that is a dated opening adjustment against the
instrument a human confirms actually paid — outstanding, and the one remaining
known inaccuracy in the cash book.

**3. `SHARED_PERIOD` confirmed**, so batch P&L stays labour-free until bird-days
allocation lands. The alternative was inventing a batch attribution for wages,
which is the thing §7 deliberately deferred.

## Still open

- **The ৳98,070 cash adjustment** described under decision 2.
- **`system-design-arc.md` §4** still says "a `Payment` row pays it out,
  `ref_type` pointing back at the `PayrollRecord`" — wrong on both counts: the
  payout pays it, and the cash row references the payout, not the record.

## Not in scope

Employer-side statutory costs (festival bonus, gratuity, provident fund) are not
modelled anywhere yet. They are cost accruals that do not arise from a payout, so
they do not belong in this bridge — they would be their own monthly accrual, and
they are worth pricing before the first Eid rather than after.
