# Payroll → Ledger Bridge

Status: **design, not built.** Three decisions at the bottom need answering first.

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

### What has to change

- **Migration** — `ALTER TYPE "PaymentRefType" ADD VALUE 'PAYROLL';` Additive.
- **`owedForRef`** (`payment.service.ts`) — a `PAYROLL` case returning
  `amount + fee_paid_by_farm`, so the existing over-payment guard covers it.
- **`markPaid`** — writes the two rows; needs `from_instrument_id`.
- **Payout modal** — a second select, "Paid from", listing active instruments.
  Six already exist.
- **`system-design-arc.md` §4** is stale either way: it still says "a `Payment`
  row pays it out, `ref_type` pointing back at the `PayrollRecord`", which is
  wrong on both counts today.

`markPaid` will write `tx.payment.create` directly rather than calling
`PaymentService.create`, which opens a transaction of its own. The guard that
call would add is redundant here — a payout can only be confirmed once, so it
cannot be over-paid.

## Decisions needed

**1. Where does the source instrument come from?** A required "Paid from" select
on the modal is honest and it is information the farm has — but it is one more
field every month. The alternative is one configured payroll wallet, defaulted
and overridable. Recommend the select: with six instruments, which wallet paid
wages is worth recording, and a default that is silently wrong corrupts a
specific wallet's balance.

**2. What happens to the 8 existing payouts (৳98,070)?** Their `Expense` rows are
reconstructable — `paid_at` and `amount` are both on the row. Their `Payment`
rows are **not**: nobody recorded which wallet those transfers left, and inventing
one would put ৳98,070 of outflow on a wallet that may never have sent it.
Recommend backfilling expenses only, and correcting cash with one dated opening
adjustment against whichever instrument actually paid — a number a human confirms,
not one the migration guesses.

**3. Confirm `SHARED_PERIOD`**, accepting that batch P&L stays labour-free until
bird-days allocation. The alternative is inventing a batch attribution for wages
now, which is the thing §7 deliberately deferred.

## Not in scope

Employer-side statutory costs (festival bonus, gratuity, provident fund) are not
modelled anywhere yet. They are cost accruals that do not arise from a payout, so
they do not belong in this bridge — they would be their own monthly accrual, and
they are worth pricing before the first Eid rather than after.
