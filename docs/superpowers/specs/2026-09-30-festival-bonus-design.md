# Festival Bonus

Status: approved design, not yet implemented. **Depends on**
`2026-09-30-role-salary-config-design.md` — a bonus is a multiple of R, and R
resolves through `referenceSalaryFor()`, which that spec introduces.

## Problem

Nothing models a bonus. `docs/payroll-ledger-bridge.md` already flagged festival
bonus as unmodelled, and `PayrollRecord` cannot absorb one: it is
`@@unique([employee_id, month])` and holds the wage math, while
`PayrollPayout.payroll_record_id` is `@unique`, so there is exactly one payout per
payroll record. A bonus is money to an employee that is not a month's wage, so it
needs its own row and a payout path that will carry it.

## What is already decided

`docs/employee-payroll-design.md` settled the amount basis and it is not
revisited here:

> Festival bonus is calculated on **R**, not on `fixed_wage` — the bonus should
> not shrink because of a bad performance month.

So a bonus is `multiplier × R` (15,000 at a 1.0 multiplier), never
`multiplier × fixed_wage` (13,500).

## Decisions taken

1. **One payout path for all money to an employee.** `PayrollPayout` is
   generalised to `EmployeePayout` rather than a second payout table being added
   beside it, so a bonus inherits the proof-of-transfer rule, the derived transfer
   fee and the ledger bridge instead of a second copy of each.
2. **Religion is stored** and drives eligibility automatically, so nobody is
   forgotten at their own festival. The privacy cost was raised and accepted; the
   mitigations are in "Religion" below.
3. **Cost is recognised when paid**, not accrued monthly.

## Schema

```prisma
enum Religion {
  ISLAM
  HINDU
  CHRISTIANITY
  BUDDHISM
  OTHER
}

model BonusEvent {
  id                 String    @id @default(uuid())
  name               String    // "Eid ul-Fitr 2026"
  event_date         DateTime
  /// null = farm-wide, for a good-harvest or one-off bonus that is not a
  /// religious festival. Set = only employees of that religion are auto-selected.
  religion           Religion?
  /// × the employee's reference salary. 1.00 = one month's R.
  multiplier         Decimal   @db.Decimal(4, 2)
  /// Full entitlement needs this much continuous service at event_date.
  min_service_months Int       @default(12)
  /// Below the threshold: pay amount × service_months / 12 instead of nothing.
  prorate            Boolean   @default(true)
  created_by_id      String
  created_by         Profiles  @relation(fields: [created_by_id], references: [id])
  created_at         DateTime  @default(now())

  bonuses Bonus[]
}

model Bonus {
  id               String     @id @default(uuid())
  event_id         String
  event            BonusEvent @relation(fields: [event_id], references: [id])
  employee_id      String
  employee         Employees  @relation(fields: [employee_id], references: [id])
  /// All three snapshotted: the event's multiplier and the employee's salary can
  /// both move afterwards, and this row has to keep showing how it was computed.
  amount           Decimal    @db.Decimal(10, 2)
  reference_salary Decimal    @db.Decimal(10, 2)
  service_months   Int
  note             String?
  created_at       DateTime   @default(now())

  payout EmployeePayout?

  @@unique([event_id, employee_id])
  @@index([employee_id])
}
```

`@@unique([event_id, employee_id])` is the invariant that makes double-paying at
one festival impossible.

On `Employees`: `religion Religion?`, nullable.

### `PayrollPayout` → `EmployeePayout`

The table is renamed and its link generalised. Nothing else on it changes —
`method`, `account_number`, `amount`, `fee_paid_by_farm`, `transaction_ref`,
`status`, `paid_by_id`, `paid_at` all keep their current meaning and rules.

```prisma
  payroll_record_id String?        @unique
  payroll_record    PayrollRecord? @relation(...)
  bonus_id          String?        @unique
  bonus             Bonus?         @relation(...)
```

Exactly one of the two must be set. Prisma cannot express that, so the migration
adds it directly:

```sql
ALTER TABLE "EmployeePayout" ADD CONSTRAINT "EmployeePayout_one_link"
  CHECK (("payroll_record_id" IS NULL) <> ("bonus_id" IS NULL));
```

`create()` requires one and rejects both or neither before reaching the database,
so the constraint is a backstop, not the error path.

## Eligibility

Computed against the event, from fields that already exist:

- `service_months` = **completed** whole months from `Employees.joining_date` to
  `BonusEvent.event_date`; a partial month does not count.
- **Auto-selected** when `employment_status = CONFIRMED` **and** the religion
  matches (see below) **and** `service_months >= min_service_months`.
- **Auto-selected at a prorated amount** when everything above holds except
  service, and `prorate` is true:
  `round(multiplier × R × service_months / 12)`.

  The divisor is always **12**, never `min_service_months`. Proration expresses
  "this share of a year's entitlement", so lowering the threshold to 6 months must
  not double what a 3-month employee receives. Stated explicitly because dividing
  by the threshold is the obvious wrong reading.
- **Listed but unticked** otherwise, with the reason shown. Never silently
  dropped — the owner decides, the system only proposes.
- `TERMINATED` employees are excluded from the proposal entirely.

### Religion

- The event's `religion` is null → every employee matches (farm-wide bonus).
- The event's `religion` is set and the employee's matches → auto-selected.
- The employee's `religion` is **null** → *listed for manual selection*, labelled
  "religion not recorded", never auto-selected and never silently skipped. This is
  the failure mode the field exists to prevent: an employee who declined to state
  must not vanish from their own festival's list.

Because it is sensitive personal data:

- The column is nullable and no code path requires it.
- It is omitted from the payslip response, the same way `account_number` is masked
  to its last four digits there.
- It appears in the bonus proposal and on the employee's own record, nowhere else.

## Amount

`multiplier × referenceSalaryFor(employee)`, rounded to whole taka — the same
rounding the allowance already uses. `referenceSalaryFor` comes from the role
salary spec, so a bonus honours an employee's override exactly as payroll does.

`Bonus` snapshots `amount`, `reference_salary` and `service_months` together: the
multiplier and the salary can both change later, and a paid bonus must keep
showing the arithmetic that produced it.

## Flow

Propose, then commit. No server-side wizard state.

1. `POST /bonus-events` — creates the event only.
2. `GET /bonus-events/:id/proposal` — **pure computation, no writes.** Returns
   every non-terminated employee with their computed amount, service months,
   whether they would be auto-selected, and the reason when they would not.
3. `POST /bonus-events/:id/bonuses` — takes the confirmed
   `[{ employee_id, amount, note? }]` and writes `Bonus` rows. Amounts are
   accepted from the client here because the owner is explicitly allowed to adjust
   them; each row records what was actually granted.
4. Each bonus is then paid through the same payout flow as a wage.

On step 4: the *server* needs no new code, which is the whole return on the
rename. The **web modal does** — `payout-dialog.tsx` currently takes a
`record: PayrollRecord` prop and derives the amount from `record.total_pay`. It
has to accept either a payroll record or a bonus. That is a prop and a label
change, not new payout logic, but it is not free and it is listed in the blast
radius below.

## Ledger

`markPaid` on an `EmployeePayout` already emits an `Expense` and a `Payment`.
It gains one branch: the expense category is `SALARY` when the payout links a
payroll record and `FESTIVAL_BONUS` when it links a bonus. Both are
`SHARED_PERIOD` — farm-wide, recurring, traceable to no batch — and
`FESTIVAL_BONUS` is upserted on first use exactly as `SALARY` and
`SALARY_TRANSFER_FEE` are.

The `Payment` row is unchanged, including `ref_type = PAYROLL`. A separate `BONUS`
ref type was considered and rejected: `ref_id` points at the payout either way,
the payout says which kind it is, and the `Expense` category already carries the
cost classification. One enum value for "money to an employee via a payout" is
enough.

**Recognised when paid, not accrued.** Accruing 1/12 of the expected bonus each
month is more correct accounting, but wages in this system are already recognised
on payment, and half-migrating the ledger to accrual is worse than being
consistently cash-basis. Named as deferred rather than treated as settled.

## Migration

One migration, run after the role salary migration:

1. `CREATE TYPE "Religion"`; add `Employees.religion` as nullable.
2. Create `BonusEvent` and `Bonus`.
3. `ALTER TABLE "PayrollPayout" RENAME TO "EmployeePayout"`, renaming its indexes
   and constraints with it. A rename preserves the 8 live rows and their ids, so
   the `Payment.ref_id` values already pointing at them stay valid.
4. Make `payroll_record_id` nullable; add `bonus_id` and the check constraint.
   Every existing row has a payroll record and no bonus, so the constraint holds
   on the existing data — verify in the migration rather than assuming.

## Blast radius

The rename is the largest piece of this spec and the reason to do it on its own:

- `payroll-payout.service.ts`, its controller, routes and validators
- `payroll-record.service.ts` — the payslip assembler reads `record.payout`
- `payment.service.ts` — `owedForRef`'s `PAYROLL` case reads `payrollPayout`
- `alert.service.ts` — the unpaid-payroll scan
- `web/src/pages/employees/payout-dialog.tsx` and the payslip page
- `docs/employee-payroll-design.md`, `docs/payroll-ledger-bridge.md` and
  `docs/system-design-arc.md` all name `PayrollPayout` in prose

## Testing

- Proration: exactly 12 months pays full; 8 months pays `8/12` rounded; 8 months
  with `prorate: false` is listed unticked, not auto-selected.
- Religion: matching auto-selects; mismatched is listed unticked; **null is listed
  with "religion not recorded" and is never auto-selected**; a null-religion event
  selects everyone.
- `TERMINATED` never appears in a proposal.
- `@@unique([event_id, employee_id])` rejects a second bonus for one employee at
  one event.
- The check constraint rejects a payout with both links and one with neither.
- A bonus payout cannot be confirmed without a `transaction_ref` — the inherited
  rule, asserted again here because inheriting it is the whole point of the
  rename.
- Confirming a bonus payout writes a `FESTIVAL_BONUS` expense and one `Payment`;
  confirming a wage payout still writes `SALARY`.
- `GET /proposal` writes nothing: row counts before and after are equal.
- Every existing payout test passes against the renamed table.

## Deferred

- Monthly accrual of expected bonus cost.
- Gratuity and provident fund. Both are employer-side statutory costs that, unlike
  a festival bonus, do not arise from a payout at all — they are period accruals
  and belong with the accrual work above, not here.
- Recurring events. Each festival is created by hand; there is no calendar and no
  "repeat annually", because Eid moves against the Gregorian calendar every year
  and a naive yearly repeat would be wrong more often than right.
