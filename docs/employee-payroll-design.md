# Employee Performance & Payroll — Design Doc

Standalone. References `Employees`/`Profiles` from `codes/previous_schema.prisma`
(role hierarchy already exists there: `UserRole` / `EmployeeRoleNames`).

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
- **Monthly sum → capped adjustment**: `-10%` floor, `+20%` ceiling, as decided.
  ```
  adjustment_percent = clamp(sum_of_points_this_month, -10, +20)
  final_salary = baseline_salary × (1 + adjustment_percent / 100)
  ```
  No entries in a month → sum is 0 → no change, matching "if zero then no change."
  Points map 1:1 to percent, so the criteria below are sized directly in those terms
  — no separate score-to-percent conversion step to keep track of.

## Criteria

Fixed point values per occurrence, not a severity range the rater picks — keeps
every entry auditable and comparable without asking a rater to also judge "how bad
was it," which is where scoring systems usually get inconsistent between raters.

### Positive

| Criterion | Points | Notes |
|---|---|---|
| Perfect attendance for the month | +3 | No unexcused absence, no pattern of lateness |
| Caught/reported a problem early (sick birds, equipment fault, biosecurity risk) before it escalated | +3 | The single highest-leverage behavior on a farm — reward it well |
| Proactive suggestion implemented (cost saving, efficiency, safety) | +3 | Only on actual implementation, not just suggesting |
| Zero mortality/loss attributable to negligence in their area this month | +2 | Distinct from unavoidable mortality — negligence-caused only |
| Accurate, timely data entry (feed allocation, mortality log, consumption, purchases) | +2 | Directly protects the FMS data this whole system depends on |
| Followed biosecurity/safety protocol consistently | +2 | |
| Helped train or cover for a struggling/new coworker | +2 | |
| Completed an urgent task beyond assigned duty | +2 | |
| *(Manager)* Team hit its output/performance target for the month | +3 | |
| *(Manager)* Resolved a conflict/issue without it escalating to the Owner | +2 | |

### Negative

| Criterion | Points | Notes |
|---|---|---|
| Inaccurate or falsified data entry/record | -5 | Most severe — corrupts the ledger everything else in FMS relies on |
| Negligence causing bird injury/loss or a mortality spike | -5 | |
| Biosecurity/safety protocol violation | -4 | |
| Concealing a known problem instead of reporting it | -4 | |
| Missed or delayed a critical task (late feed allocation, missed medicine schedule) | -3 | |
| Damage to equipment/property from carelessness | -3 | |
| Insubordination or a conduct issue | -3 | |
| *(Manager)* Repeated team errors traceable to lack of supervision | -3 | |
| Unexcused absence | -2 | Per occurrence |
| Pattern of lateness | -2 | Per month it's a recurring issue, not per instance |

### Escape hatch

| Criterion | Points | Notes |
|---|---|---|
| `OTHER` | rater enters ±1 to ±5 | For anything real that doesn't fit the fixed list — always with a reason. A fixed list will never cover everything; better to have one deliberate escape hatch than force a bad-fit category. |

## Data Model

```prisma
model PerformanceScoreEntry {
  id          String   @id @default(uuid())
  employee_id String
  employee    Employees @relation(fields: [employee_id], references: [id])
  given_by_id String
  given_by    Profiles  @relation(fields: [given_by_id], references: [id])
  criterion   PerformanceCriterion
  points      Int       // signed; snapshot of the criterion's value at time of entry
  reason      String    // required — never optional
  date        DateTime  @default(now())
  created_at  DateTime  @default(now())

  @@index([employee_id, date])
}

enum PerformanceCriterion {
  ATTENDANCE_PERFECT
  EARLY_PROBLEM_REPORT
  SUGGESTION_IMPLEMENTED
  ZERO_NEGLIGENT_LOSS
  ACCURATE_DATA_ENTRY
  BIOSECURITY_FOLLOWED
  HELPED_COWORKER
  EXTRA_TASK_COMPLETED
  TEAM_TARGET_HIT
  CONFLICT_RESOLVED
  FALSIFIED_RECORD
  NEGLIGENT_LOSS
  BIOSECURITY_VIOLATION
  CONCEALED_PROBLEM
  MISSED_CRITICAL_TASK
  EQUIPMENT_DAMAGE
  CONDUCT_ISSUE
  TEAM_SUPERVISION_FAILURE
  UNEXCUSED_ABSENCE
  PATTERN_LATENESS
  OTHER
}

model PayrollRecord {
  id                 String    @id @default(uuid())
  employee_id        String
  employee           Employees @relation(fields: [employee_id], references: [id])
  month              DateTime  // normalized to first-of-month
  baseline_salary    Decimal   @db.Decimal(10, 2)
  score_sum          Int       // raw sum, pre-clamp, kept for audit/history
  adjustment_percent Decimal   @db.Decimal(5, 2) // the clamped value actually applied
  final_salary       Decimal   @db.Decimal(10, 2)
  created_at         DateTime  @default(now())

  @@unique([employee_id, month])
}
```

`PayrollRecord` is a locked snapshot per employee per month — even if `Employees.salary`
(baseline) or a criterion's point value changes later, past months' actual pay stays
correct and auditable. Paying it out is just a `Payment` row (already exists in the
reference schema) referencing this record.

## Worked Examples — baseline ₹15,000/month

| Scenario | Entries | Raw sum | Clamped | Final salary |
|---|---|---|---|---|
| Great month | Perfect attendance (+3), suggestion implemented (+3), accurate logging (+2) | +8 | +8% | ₹16,200 |
| Mixed month | Perfect attendance (+3), one late feed allocation (-3), one unexcused absence (-2) | -2 | -2% | ₹14,700 |
| Bad month | Biosecurity violation (-4), negligent mortality spike (-5), equipment damage (-3) | -12 | **-10%** (floor hit) | ₹13,500 |
| Exceptional month | Attendance (+3), suggestion (+3), zero negligent loss (+2), helped coworker (+2), early report (+3) | +13 | +13% | ₹16,950 |
| Runaway great month | Six positive entries averaging +4 each | +24 | **+20%** (ceiling hit) | ₹18,000 |

The floor is easier to hit than the ceiling on purpose — a couple of serious negative
entries (falsified record, negligence) should meaningfully bite; reaching the max
bonus should take a genuinely stacked month, not one lucky entry.

## v1 Simplifications

- No automated permission enforcement of who-can-score-whom yet — matches the
  existing FMS "single-user for v1, multi-role planned later" stance. Build the
  scoring/payroll data model now; wire real role-based access when multi-user auth
  lands.
- Criteria list is fixed for v1 (the `OTHER` escape hatch covers gaps) rather than
  configurable per-farm — revisit only if the fixed list proves wrong in practice.

## Open Items

- Should `OTHER` entries require a follow-up review (e.g., Owner co-signs a Manager's
  `OTHER` entry) to prevent drift into an unaudited bucket? Not blocking — start
  without it, add if `OTHER` gets overused in practice.
- Whether `PayrollRecord` generation is a manual month-end action or an automated job
  — deferred to the implementation plan.
