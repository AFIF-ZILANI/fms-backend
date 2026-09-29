# Role-Based Salary Configuration

Status: approved design, not yet implemented. Build this before
`2026-09-30-festival-bonus-design.md`, which depends on it to resolve R.

## Problem

`EmployeeRoleNames` is a Prisma enum (`MANAGER | WORKER | INTERN`), so adding a
role means a migration and a deploy. There is no standard salary anywhere: every
employee's `reference_salary` was typed in by hand at hire, and nothing records
what a Shed Worker is *supposed* to earn.

The owner wants roles and their salaries editable in Settings.

## Decisions taken

1. **Payroll reads the role's salary live**, not a copy taken at hire — with a
   per-employee override for the cases the standard does not fit.
2. **The role's salary is a default, not a mandate.** The override is what keeps
   the live model safe: see "Why the override is not optional" below.
3. **No new pay component.** An earlier round of this design added a flat "farm
   allowance" per role; it was dropped. The existing `fixed_wage` + `allowance`
   split already sums to R, so `payroll-math.ts`, `PayrollRecord`'s columns and
   the payslip are all untouched by this work.

### Why the override is not optional

The current data:

| Role | `reference_salary` |
| --- | --- |
| MANAGER | 15,000 |
| WORKER | 5,000 · 10,000 · 12,000 · 15,000 |

Four workers, four salaries. A role-level figure with no override would collapse
them to one number and change three people's pay the moment the config was
saved — and two of the four would be *cut*, which §125 makes a problem. So the
role carries the standard, the employee may carry an exception, and the migration
moves nobody's pay.

## Schema

```prisma
model EmployeeRole {
  id               String   @id @default(uuid())
  code             String   @unique      // SHED_WORKER, GENERAL_MANAGER, INTERN
  label            String                // "Shed Worker"
  reference_salary Decimal  @db.Decimal(10, 2)
  is_active        Boolean  @default(true)
  created_at       DateTime @default(now())
  updated_at       DateTime @updatedAt

  employees Employees[]
}
```

A uuid `id` with a unique `code`, structurally identical to
`ExpenseCategoryLookup` — which is exactly how `Expense.category` already
references a lookup by code while the row itself is addressed by id.

On `Employees`:

- `role` becomes `String` + a relation to `EmployeeRole.code`, `onUpdate: Cascade`
  so a corrected code propagates. The existing `@@index([role])` stays.
- `reference_salary` becomes **nullable**. Non-null means "this employee is an
  exception to their role's standard"; null means "use the role's".
- `fixed_wage` is **dropped**. It is exactly `0.9 × reference_salary` on all five
  rows, and `generate()` already ignores it and recomputes via `computePay` — so
  the rule its comment asserts ("must survive any later change to the 0.9 ratio")
  has never actually held. The figure that *is* immutable is
  `PayrollRecord.fixed_wage`: a snapshot of what was really paid, in a row whose
  month is locked. Dropping the column removes a contradiction rather than
  patching one.
- `EmployeeRoleNames` is dropped from the schema once `Employees.role` is a
  string. Postgres cannot remove an enum value in place, but the whole type goes,
  so a plain `DROP TYPE` after the column is converted is enough.

## Resolution

One function, used by every caller that needs an employee's R:

```
referenceSalaryFor(employee) = employee.reference_salary ?? employee.role.reference_salary
```

`PayrollRecordService.generate()` calls it in place of reading
`employee.reference_salary` directly (currently line ~137) and snapshots the
result into `PayrollRecord.reference_salary` as it already does. If the employee
has no override *and* their role has no salary, generate throws
`AppError.badRequest` naming the role — silently paying zero is the one outcome
worth refusing.

Everything downstream is unchanged: `computePay` still takes R and a score sum,
`PayrollRecord` gains no columns, the payslip renders as before.

## Migration

One migration (`prisma migrate` assigns the timestamp), in this order:

1. Create `EmployeeRole`.
2. Seed three rows from the enum's values:
   `MANAGER → label "Manager"`, `WORKER → "Worker"`, `INTERN → "Intern"`, each
   with `reference_salary` seeded as described below.
3. Convert `Employees.role` from the enum to `String`, add the FK.
4. `DROP TYPE "EmployeeRoleNames"`.
5. Leave every `Employees.reference_salary` exactly as it is — all five rows keep
   their current figure, so all five are overrides and no role standard drives
   anyone's pay on day one.

**Seeded standards need confirming, not guessing.** `MANAGER` is unambiguous at
15,000. `WORKER` has four distinct values and no mode, so it is seeded at 15,000
(the highest, matching Santo) — a number the owner is expected to correct in
Settings. The seed is a starting point for future hires; because every existing
employee holds an override, a wrong seed cannot move anyone's pay.

Renaming `WORKER → SHED_WORKER` and adding `GENERAL_MANAGER` is deliberately left
to the UI. That is the feature.

## API

**`lookup-factory` cannot be reused here, despite appearances.** Its
`LookupDelegate` type declares `create(data: { code, label })` and
`update(data: { code?, label?, is_active? })` — there is no room for
`reference_salary`, and every write would drop it. Making the factory generic over
arbitrary extra fields, for its fifth caller and the only one that needs it, buys
less than it costs.

So: a dedicated `employee-role.service.ts`, roughly 60 lines, reusing the two
pieces that actually carry the value rather than the wrapper around them:

- `generateCode(label)` from `@lib/code-gen`, called **once at create and never on
  rename** — the behaviour `lookup-factory`'s `stableCode` option exists for.
  `Employees.role` routes on the code, so a label edit must not regenerate it.
- the Postgres `P2003` guard, which the factory turns into
  `AppError.conflict("... is still in use and cannot be deleted. Deactivate it
  instead.")`. That is the right message for a role with employees on it, so the
  wording is copied deliberately.

The service also returns an `employee_count` per role on list, so the UI can show
what a change affects.

`employee.validator.ts` replaces `z.enum(["MANAGER","WORKER","INTERN"])` with
`z.string().min(1)`, validity enforced by the FK — the same pattern
`Expense.category` already uses.

## Auditing salary changes

`AuditLog` exists with a read API and **no writer**. Changing an employee's
salary override gives it its first one: an `UPDATE` row with
`table_name: "Employees"`, `record_id`, `before_data` / `after_data` carrying the
old and new figure, and `changed_by_id` from `getActorId`. That is what makes an
override "visible and audited as an exception" rather than an untracked edit to
someone's pay.

Role salary edits are not audited in this iteration — see Deferred.

## Settings UI

A "Roles & Salaries" tab on the existing Settings page, beside "Categories &
Units". Not `LookupManagerCard`: that component handles code/label only and this
carries money. A sibling card in the same shape, one row per role showing label,
code, reference salary (editable), the derived fixed wage (`0.9 × R`, read-only,
so the admin sees what they are committing to), employee count, and the active
toggle.

Deleting a role with employees surfaces the factory's conflict message and offers
deactivation instead.

On the employee form, salary becomes "uses the role standard (৳X)" with an
"override" toggle revealing the amount field — so an exception is a deliberate
act, not the default path.

## Testing

- `referenceSalaryFor`: override wins; falls back to the role; throws when
  neither exists.
- `generate()` produces identical figures to today for an employee with an
  override — the regression that matters, since all five current employees have
  one.
- Deleting a role with employees returns 409; deactivating succeeds.
- A label edit leaves `code` untouched.
- Editing an employee's override writes exactly one `AuditLog` row with both
  figures.
- Migration check: all five employees' salaries survive unchanged, and three
  roles exist.
- Existing `payroll-math.test.ts` passes **unchanged**. If it does not, something
  this spec claims not to touch has been touched.

## Deferred

- **Effective-dated role salaries.** An earlier draft had these, for correctness
  when back-dating payroll after a rate change. The override model narrowed the
  exposure to a future override-less employee whose role's salary changed between
  the payroll month and the day it was generated; `PayrollRecord` snapshots
  everything once generated, so history is already safe. One column beats a table
  plus a join plus resolution logic. A `ponytail:` comment on
  `EmployeeRole.reference_salary` names the upgrade path.
- **Auditing role salary edits**, which needs the same `AuditLog` writer pointed
  at a second table. Worth doing when a role standard actually drives someone's
  pay, which it does not yet.
- Salary bands, headcount caps, per-role leave entitlement, probation length,
  overtime rates, performance-pay eligibility flags. None were asked for.
