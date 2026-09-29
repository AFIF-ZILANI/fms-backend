# Employee Performance & Payroll — Design Doc

Standalone. References `Employees`/`Profiles` from `prisma/schema.prisma`
(role hierarchy already exists there: `UserRole` / `EmployeeRoleNames`).

## Pay Structure

Performance pay is an **allowance on top of a guaranteed fixed wage**, never a
deduction from one. The Bangladesh Labour Act 2006 s.125 limits what an employer
may deduct from a worker's wages, and a scheme that shrinks the contractual wage
on bad months would be a deduction in substance whatever it is called. So the
contractual wage is set below the normal-month total, and the difference is paid
as a performance allowance that varies.

| Term              | Definition                          | Example (R = ৳15,000) |
| ----------------- | ----------------------------------- | --------------------- |
| `reference_salary` (R) | Normal-month total pay, the figure quoted when hiring | ৳15,000 |
| `fixed_wage`      | `0.9 × R` — guaranteed every month, stated in the appointment letter | ৳13,500 |
| `P`               | `clamp(sum of the month's points, -10, +20)`; 1 point = 1% of R | -10 … +20 |
| `allowance`       | `R × (10 + P) / 100` | ৳0 – ৳4,500 |
| `total_pay`       | `fixed_wage + allowance` | ৳13,500 – ৳18,000 |

```
P         = clamp(score_sum, -10, +20)
allowance = round(R × (10 + P) / 100)
total_pay = fixed_wage + allowance
```

A month with no entries gives `P = 0`, so the allowance is exactly 10% of R and
the total is exactly R — "if zero then no change" still holds, now without ever
touching the contractual wage. Allowance and total are **rounded to whole taka**.

Festival bonus is calculated on **R**, not on `fixed_wage` — the bonus should not
shrink because of a bad performance month. Overtime and every other statutory
amount follow the Labour Act as normal.

## Mechanics

- **One score line per employee per month** — not separate manager/owner tracks.
  Any senior authority scoring that employee adds a signed point entry
  (`+points` or `-points`) tied to a criterion, with a **required reason** (free
  text). At month end, all entries for that employee that month are summed.
- **Who can score whom**: Manager or Owner can score a Worker; Owner can score a
  Manager. Nobody scores the Owner. This is a role-hierarchy rule enforced in
  application logic, not a schema constraint — full role/permission enforcement is
  part of the multi-user phase the original FMS plan already deferred
  (`docs/PREVIOUS_CONTEXT.md` §3: v1 is single-user).
- **No self-scoring**: `given_by_id` must never equal the employee's own
  `profile_id`. Enforced in application logic from v1, ahead of the wider
  role-permission work — it is a single comparison and the one abuse the model
  cannot otherwise survive.
- **The month is bucketed by `incident_date`, not `created_at`.** Every entry
  carries a required `incident_date` — the day the thing actually happened. An
  entry written up three days late still belongs to the month it occurred in.
- **Monthly sum → clamped allowance**: `-10` floor, `+20` ceiling, as decided.
  Points map 1:1 to percent of R, so the criteria below are sized directly in
  those terms — no separate score-to-percent conversion step to keep track of.

### Entry Rules

- **Visibility and dispute.** The employee can see every entry written about
  them. They may dispute an entry within **7 days** of being shown it; the Owner
  resolves the dispute **in writing**. A disputed entry sits at status `DISPUTED`
  until resolved.
- **Written notice before a heavy negative.** Any entry of **-4 or worse**
  requires written notice to the employee *first*, stored as `notice_doc_url`.
  No notice, no entry.
- **Points are not a disciplinary process.** Serious misconduct — falsified
  records above all — additionally goes through the Labour Act **s.23–24
  show-cause procedure**. A -5 entry is a pay consequence, not a substitute for
  the statutory process, and never a bar to it.
- **`OTHER` needs Owner approval.** An `OTHER` entry records `approved_by_id`
  and is capped at **±5 total per employee per month** across all `OTHER`
  entries. This closes the unaudited-bucket risk rather than leaving it to be
  watched for.
- **Entries are never deleted.** Status is `ACTIVE | DISPUTED | VOIDED`; voiding
  requires a `void_reason`. A wrong entry is voided, leaving the record of both
  the entry and the correction.
- **The month locks on payroll generation.** Once a `PayrollRecord` exists for an
  employee-month, any new or edited entry whose `incident_date` falls in that
  month is rejected. Pay that has been calculated cannot be retroactively
  re-based.

## Criteria

Fixed point values per occurrence, not a severity range the rater picks — keeps
every entry auditable and comparable without asking a rater to also judge "how bad
was it," which is where scoring systems usually get inconsistent between raters.

### Positive

| Criterion                                                                                           | Points | Notes                                                           |
| --------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------- |
| Perfect attendance for the month                                                                    | +3     | No unexcused absence, no pattern of lateness                    |
| Caught/reported a problem early (sick birds, equipment fault, biosecurity risk) before it escalated | +3     | The single highest-leverage behavior on a farm — reward it well |
| Proactive suggestion implemented (cost saving, efficiency, safety)                                  | +3     | Only on actual implementation, not just suggesting              |
| Zero mortality/loss attributable to negligence in their area this month                             | +2     | Distinct from unavoidable mortality — negligence-caused only    |
| Accurate, timely data entry (feed allocation, mortality log, consumption, purchases)                | +2     | Directly protects the FMS data this whole system depends on     |
| Followed biosecurity/safety protocol consistently                                                   | +2     |                                                                 |
| Helped train or cover for a struggling/new coworker                                                 | +2     |                                                                 |
| Completed an urgent task beyond assigned duty                                                       | +2     |                                                                 |
| _(Manager)_ Team hit its output/performance target for the month                                    | +3     |                                                                 |
| _(Manager)_ Resolved a conflict/issue without it escalating to the Owner                            | +2     |                                                                 |

### Negative

| Criterion                                                                          | Points | Notes                                                              |
| ---------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------ |
| Inaccurate or falsified data entry/record                                          | -5     | Most severe — corrupts the ledger everything else in FMS relies on |
| Negligence causing bird injury/loss or a mortality spike                           | -5     |                                                                    |
| Biosecurity/safety protocol violation                                              | -4     |                                                                    |
| Concealing a known problem instead of reporting it                                 | -4     |                                                                    |
| Missed or delayed a critical task (late feed allocation, missed medicine schedule) | -3     |                                                                    |
| Damage to equipment/property from carelessness                                     | -3     |                                                                    |
| Insubordination or a conduct issue                                                 | -3     |                                                                    |
| _(Manager)_ Repeated team errors traceable to lack of supervision                  | -3     |                                                                    |
| Unexcused absence                                                                  | -2     | Per occurrence                                                     |
| Pattern of lateness                                                                | -2     | Per month it's a recurring issue, not per instance                 |

### Escape hatch

| Criterion | Points                | Notes                                                                                                                                                                                         |
| --------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OTHER`   | rater enters ±1 to ±5 | For anything real that doesn't fit the fixed list — always with a reason. A fixed list will never cover everything; better to have one deliberate escape hatch than force a bad-fit category. Requires Owner approval (`approved_by_id`) and is capped at ±5 total per employee per month. |

## Data Model

```prisma
model PerformanceScoreEntry {
  id              String               @id @default(uuid())
  employee_id     String
  employee        Employees            @relation(fields: [employee_id], references: [id])
  given_by_id     String
  given_by        Profiles             @relation("ScoreGivenBy", fields: [given_by_id], references: [id])
  approved_by_id  String?              // required when criterion = OTHER
  approved_by     Profiles?            @relation("ScoreApprovedBy", fields: [approved_by_id], references: [id])
  criterion       PerformanceCriterion
  points          Int                  // signed; snapshot of the criterion's value at time of entry
  reason          String               // required — never optional
  incident_date   DateTime             // required; the day it happened, and what buckets the month
  notice_doc_url  String?              // required when points <= -4
  status          ScoreEntryStatus     @default(ACTIVE)
  void_reason     String?              // required when status = VOIDED
  acknowledged_at DateTime?            // when the employee confirmed they were shown it
  created_at      DateTime             @default(now())
  idempotency_key String               @unique

  @@index([employee_id, incident_date])
}

enum ScoreEntryStatus {
  ACTIVE
  DISPUTED
  VOIDED
}

model PayrollRecord {
  id                 String    @id @default(uuid())
  employee_id        String
  employee           Employees @relation(fields: [employee_id], references: [id])
  month              DateTime  // normalized to first-of-month
  reference_salary   Decimal   @db.Decimal(10, 2) // snapshot of R
  fixed_wage         Decimal   @db.Decimal(10, 2) // snapshot of 0.9 × R
  score_sum          Int       // raw sum, pre-clamp, kept for audit/history
  adjustment_percent Int       // P — the clamped value actually applied
  allowance          Decimal   @db.Decimal(10, 2)
  total_pay          Decimal   @db.Decimal(10, 2)
  locked_at          DateTime  @default(now()) // after this, the month rejects entry edits
  created_at         DateTime  @default(now())

  @@unique([employee_id, month])
}
```

`adjustment_percent` is an `Int`, not a `Decimal`: P is a clamped sum of integer
points, so it can never carry a fraction, and the old `Decimal(5,2)` implied a
precision the value does not have.

`PayrollRecord` is a locked snapshot per employee per month. `reference_salary`
and `fixed_wage` are stored on the row rather than read from `Employees`, so a
later raise or a changed criterion value never rewrites what someone was actually
paid in March.

On `Employees`, the single `salary` field is replaced by the pair:

```prisma
reference_salary Decimal @db.Decimal(10, 2) // R — normal-month total pay
fixed_wage       Decimal @db.Decimal(10, 2) // 0.9 × R, stored explicitly
```

`fixed_wage` is stored rather than derived. It is the number written into a
signed appointment letter; if the 0.9 ratio is ever revisited, existing contracts
must keep the figure their holder signed.

## Salary Payout

Calculating pay and paying it are different events with different failure modes,
so they are different rows.

### Methods

`BANK | BKASH | NAGAD | ROCKET`.

Default to **MFS (bKash/Nagad) for shed workers** and **bank transfer where the
employee has an account**. **Cash is not a payout method.** A wage handed over in
cash leaves nothing an auditor can follow, so every payout needs a destination
account on file and the transaction reference it produced. The schema enum still
carries `CASH` for historical rows; the validator does not accept it, so no new
payout can use it. An employee with no account on file cannot be paid — that is
the intended block, not a gap.

### Transfer fees

Two different fees get confused here, so they are named apart:

- **The send fee** — what the *farm* pays to move the money. The farm bears it,
  and FMS computes and records it. This is the one the system models.
- **The cash-out fee** — what the *employee* pays their MFS to withdraw notes
  (~1.85% on a personal bKash). The farm does not pay this and cannot see it: it
  is charged by bKash to the employee, on their own withdrawal, at a time and
  amount FMS never learns. Nothing to record.

What the send fee actually is, by destination:

| Destination | Charge | Note |
| --- | --- | --- |
| Bank (BEFTN) | none | BEFTN credits are free to the sender; RTGS carries a small flat charge, but wages go by BEFTN |
| bKash / Nagad / Rocket | flat per transaction | Send Money from a personal account |
| MFS business disbursement | a percentage | Negotiated per contract, and cheaper per taka at payroll volume |

So the fee is **not a single percentage** — it is `flat + amount x percent`, in
`lib/payout-fees.ts`, one entry per method. A farm that signs a bKash
disbursement agreement moves its number from `flat` to `percent` there and
nothing else changes. **The defaults need verifying before the first run**: they
are published personal-account rates as understood at the time of writing, and
both bKash and Nagad revise theirs.

On the legal side: under the Labour Act 2006 the employer may deduct from wages
only what §125 authorises, and a transfer cost is not on that list. Netting the
fee off before transferring would be an unauthorised deduction, so the design
makes it impossible — `amount` is always the full `total_pay`, and the fee is a
separate figure on top. (Not legal advice; worth one pass by a local adviser.)

### Recording It

The fee is **derived, never typed in.** `fee_paid_by_farm` is computed from the
destination and the amount when the payout is created, and is absent from the
request body: a client that can quote its own fee can quote any number into the
P&L. It is snapshotted on the row because the published rate will have moved on
by the time anyone reads it back.

On confirm, in the same transaction as the status change, the fee becomes an
**`Expense`** under category `SALARY_TRANSFER_FEE`, `cost_type SHARED_PERIOD`
(farm-wide, recurring, traceable to no one batch), attributed to the actor who
confirmed the payout. Written on confirm rather than create, because an unpaid
payout has cost nothing yet. The category row is upserted on first use, so no
seeding step stands between a fresh install and the first payroll.

It never inflates `total_pay`: the gross is the signed contract figure, and
letting a transfer fee into it would corrupt both the payslip and the
performance-pay arithmetic built on top of it.

Known gap: **salaries themselves reach neither the cost book nor the cash book**,
so the P&L sees the transfer fee but not the wage it carried, and `cash_position`
never drops when wages go out. Designed in `docs/payroll-ledger-bridge.md`, which
is waiting on three decisions; not papered over by expensing wages from here.

### Payout Accounts Are Append-Only

Changing where someone's wage lands is the single most attractive target in a
payroll system, so an account is never edited in place. A change is a **new row
plus `active_to` set on the old one**, and requires:

- the employee's **signed change request**, and
- **Owner approval**, stamped from the session as `verified_by_id` /
  `verified_at` and never accepted from the request body — a client that can
  name who approved a change of wage destination can forge the approval.

If the wallet or account is **not in the employee's own name**, record
`holder_relation` (e.g. spouse, father). A blank `holder_relation` means the
account is the employee's own. No separate consent document is collected: the
signed change request already names the account, and the Owner approving it is
recorded on the row.

### Paying

- A payroll **cannot be marked paid without proof**: the `transaction_ref` from
  the transfer (bKash TrxID, bank reference). There is no alternative form of
  proof, because there is no payout method that produces one.
- Pay by the **7th working day after month end**. FMS raises a warning on **day
  5** — the same alert scan that already watches probation end dates and
  ungenerated payroll.
- The **payslip** shows: fixed wage, allowance, every score entry with its
  reason, and the payout method with the **last 4 digits** of the account.

```prisma
enum PayoutMethod {
  BANK
  BKASH
  NAGAD
  ROCKET
  CASH // historical only -- rejected by the validator, see Methods above
}

enum PayoutStatus {
  PENDING
  SENT
  FAILED
  CONFIRMED
}

model EmployeePayoutAccount {
  id              String       @id @default(uuid())
  employee_id     String
  employee        Employees    @relation(fields: [employee_id], references: [id])
  method          PayoutMethod
  account_name    String
  account_number  String
  bank_name       String?
  branch_name     String?
  routing_number  String?      // 9-digit BEFTN
  holder_relation String?      // null = the employee's own account
  verified_by_id  String?
  verified_by     Profiles?    @relation("PayoutAccountVerifiedBy", fields: [verified_by_id], references: [id])
  verified_at     DateTime?
  active_from     DateTime     @default(now())
  active_to       DateTime?    // set when superseded; never edited in place
  created_at      DateTime     @default(now())

  payouts PayrollPayout[]

  @@index([employee_id, active_to])
}

model PayrollPayout {
  id                String        @id @default(uuid())
  payroll_record_id String        @unique
  payroll_record    PayrollRecord @relation(fields: [payroll_record_id], references: [id])
  payout_account_id String?
  payout_account    EmployeePayoutAccount? @relation(fields: [payout_account_id], references: [id])
  method            PayoutMethod  // snapshot
  account_number    String        // snapshot
  amount            Decimal       @db.Decimal(10, 2)
  fee_paid_by_farm  Decimal       @default(0) @db.Decimal(10, 2)
  transaction_ref   String?       // required to mark paid
  receipt_doc_url   String?       // unused -- kept for historical CASH rows
  status            PayoutStatus  @default(PENDING)
  paid_by_id        String?
  paid_by           Profiles?     @relation("PayoutPaidBy", fields: [paid_by_id], references: [id])
  paid_at           DateTime?
  created_at        DateTime      @default(now())
}
```

`method` and `account_number` are snapshotted onto the payout even though
`payout_account_id` points at the account row. The account can be closed and
superseded; the payout must keep showing where the money actually went.

### Why `PayrollPayout` and not the existing `Payment`

A generic `Payment` model already exists, carrying `ref_type` / `ref_id` across
`SALE | BIRD_SALE | PURCHASE | EXPENSE | PAYROLL`. Salary payouts move out of it
and into `PayrollPayout`; the two are **not** kept side by side.

The reason is that a salary payout carries obligations no other payment type has:
proof of transfer before it can be marked paid, a receipt when it is cash, an
account snapshot, fee attribution, and a named payer. Folding those into
`Payment` means six nullable columns that are meaningless on every sale and
purchase row, and no way to make `transaction_ref` conditionally required — the
constraint that actually matters. `Payment` stays the general cash ledger and
gets simpler for it.

**Migration path** (not part of this doc's changes): `PaymentRefType.PAYROLL` is
retained for now because rows already reference it — there are existing `PAYROLL`
payments in the database, and dropping the enum value would fail against them.
The sequence is: ship `PayrollPayout`, backfill those rows into it, repoint the
finance page's payroll-outstanding view, then remove `PAYROLL` from
`PaymentRefType`. Until that backfill runs, `PAYROLL` in `PaymentRefType` is
deprecated and must not be used for new salary payments.

## Worked Examples — reference salary R = ৳15,000, fixed wage ৳13,500

| Scenario            | Entries                                                                                             | Raw sum | Applied P              | Allowance | Total   |
| ------------------- | --------------------------------------------------------------------------------------------------- | ------- | ---------------------- | --------- | ------- |
| Normal month        | No entries                                                                                          | 0       | 0                      | ৳1,500    | ৳15,000 |
| Great month         | Perfect attendance (+3), suggestion implemented (+3), accurate logging (+2)                         | +8      | +8                     | ৳2,700    | ৳16,200 |
| Mixed month         | Perfect attendance (+3), one late feed allocation (-3), one unexcused absence (-2)                  | -2      | -2                     | ৳1,200    | ৳14,700 |
| Bad month           | Biosecurity violation (-4), negligent mortality spike (-5), equipment damage (-3)                   | -12     | **-10** (floor hit)    | ৳0        | ৳13,500 |
| Runaway great month | Six positive entries averaging +4 each                                                              | +24     | **+20** (ceiling hit)  | ৳4,500    | ৳18,000 |

Even the worst possible month still pays the full contractual `fixed_wage` of
৳13,500 — that is the whole point of the structure. The floor is easier to hit
than the ceiling on purpose: a couple of serious negative entries (falsified
record, negligence) should meaningfully bite, while reaching the maximum
allowance should take a genuinely stacked month, not one lucky entry.

## v1 Simplifications

Enforced in application logic **now**, ahead of the wider multi-user work:

- No self-scoring (`given_by_id` ≠ the employee's own `profile_id`).
- `incident_date` required on every entry, and it is what buckets the month.
- `OTHER` requires `approved_by_id` and is capped at ±5 per employee per month.
- Entries of -4 or worse require `notice_doc_url`.
- A month with a `PayrollRecord` rejects new or edited entries in that month.
- No payout marked paid without `transaction_ref`.
- No payout at all for an employee with no active payout account.

Deferred:

- **Automated permission enforcement of who-can-score-whom** beyond the
  self-scoring check — matches the existing FMS "single-user for v1, multi-role
  planned later" stance. Wire real role-based access when multi-user auth lands.
- **The 7-day dispute window is tracked, not automated.** `DISPUTED` status and
  `acknowledged_at` exist; nothing expires the window or chases the Owner for a
  written resolution yet.
- **Criteria list is fixed for v1** (the `OTHER` escape hatch covers gaps) rather
  than configurable per-farm — revisit only if the fixed list proves wrong in
  practice.

## Open Items

- Whether `PayrollRecord` generation is a manual month-end action or an automated
  job — deferred to the implementation plan.
- The team-target metric for a Manager's `TEAM_TARGET_HIT` (+3): what output or
  performance number defines "hit its target", and who sets it per month.
