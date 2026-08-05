/**
 * Fixed point value per criterion (employee-payroll-design.md "Criteria" table)
 * -- deliberately not a severity range the rater picks, so every entry stays
 * auditable/comparable. OTHER is the escape hatch: rater supplies ±1 to ±5.
 */
export const FIXED_CRITERION_POINTS = {
    ATTENDANCE_PERFECT: 3,
    EARLY_PROBLEM_REPORT: 3,
    SUGGESTION_IMPLEMENTED: 3,
    ZERO_NEGLIGENT_LOSS: 2,
    ACCURATE_DATA_ENTRY: 2,
    BIOSECURITY_FOLLOWED: 2,
    HELPED_COWORKER: 2,
    EXTRA_TASK_COMPLETED: 2,
    TEAM_TARGET_HIT: 3,
    CONFLICT_RESOLVED: 2,
    FALSIFIED_RECORD: -5,
    NEGLIGENT_LOSS: -5,
    BIOSECURITY_VIOLATION: -4,
    CONCEALED_PROBLEM: -4,
    MISSED_CRITICAL_TASK: -3,
    EQUIPMENT_DAMAGE: -3,
    CONDUCT_ISSUE: -3,
    TEAM_SUPERVISION_FAILURE: -3,
    UNEXCUSED_ABSENCE: -2,
    PATTERN_LATENESS: -2,
} as const;

export type FixedCriterion = keyof typeof FIXED_CRITERION_POINTS;
