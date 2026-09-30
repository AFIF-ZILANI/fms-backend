import { Prisma } from "../../prisma/generated/prisma/client";

export const CLAMP_MIN = -10;
export const CLAMP_MAX = 20;
/** The guaranteed wage is this share of the reference salary. */
export const FIXED_WAGE_RATIO = 0.9;
/** Allowance at P = 0, as a percentage of R -- so a zero-entry month pays exactly R. */
const BASE_ALLOWANCE_PERCENT = 10;

/** 0.9 × R, rounded to whole taka. Stored on the employee, not derived at read
 *  time: it is the figure written into a signed appointment letter. */
export function fixedWageFor(referenceSalary: Prisma.Decimal | number | string): Prisma.Decimal {
    return new Prisma.Decimal(referenceSalary).times(FIXED_WAGE_RATIO).toDecimalPlaces(0);
}

/**
 * Performance pay is an allowance on top of a guaranteed wage, never a deduction
 * from one -- see docs/employee-payroll-design.md for why (Labour Act s.125).
 *
 *   P         = clamp(score_sum, -10, +20)
 *   allowance = R × (10 + P) / 100
 *   total_pay = fixed_wage + allowance
 *
 * At P = 0 the total is exactly R; at the floor it is exactly the fixed wage.
 */
export function computePay(referenceSalary: Prisma.Decimal | number | string, scoreSum: number) {
    const reference = new Prisma.Decimal(referenceSalary);
    const adjustment_percent = Math.max(CLAMP_MIN, Math.min(CLAMP_MAX, scoreSum));
    const fixed_wage = fixedWageFor(reference);
    const allowance = reference
        .times(BASE_ALLOWANCE_PERCENT + adjustment_percent)
        .dividedBy(100)
        .toDecimalPlaces(0);
    return {
        adjustment_percent,
        fixed_wage,
        allowance,
        total_pay: fixed_wage.plus(allowance),
    };
}

/**
 * R for one employee: their own salary if they carry one, otherwise their role's
 * standard. Null is the only "absent" -- `??` rather than `||`, so an override of
 * 0 stays 0 instead of silently inheriting the role's figure.
 *
 * No failure mode: Employees.role is a required FK and EmployeeRole.reference_salary
 * is NOT NULL, so the fallback always exists. If that column is ever made
 * nullable, this has to start throwing.
 */
export function referenceSalaryFor(employee: {
    reference_salary: Prisma.Decimal | null;
    roleRef: { reference_salary: Prisma.Decimal };
}): Prisma.Decimal {
    return employee.reference_salary ?? employee.roleRef.reference_salary;
}
