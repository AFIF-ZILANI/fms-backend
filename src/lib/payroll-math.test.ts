import { describe, test, expect } from "bun:test";
import { computePay, fixedWageFor, referenceSalaryFor } from "./payroll-math";
import { Prisma } from "../../prisma/generated/prisma/client";

const D = (n: number) => new Prisma.Decimal(n);

// The worked-examples table in docs/employee-payroll-design.md, R = 15,000.
describe("computePay", () => {
    const R = 15000;

    test("a month with no entries pays exactly the reference salary", () => {
        const pay = computePay(R, 0);
        expect(pay.allowance.toNumber()).toBe(1500);
        expect(pay.total_pay.toNumber()).toBe(15000);
    });

    test("a great month", () => {
        const pay = computePay(R, 8);
        expect(pay.adjustment_percent).toBe(8);
        expect(pay.allowance.toNumber()).toBe(2700);
        expect(pay.total_pay.toNumber()).toBe(16200);
    });

    test("a mixed month never dips below the fixed wage", () => {
        const pay = computePay(R, -2);
        expect(pay.allowance.toNumber()).toBe(1200);
        expect(pay.total_pay.toNumber()).toBe(14700);
    });

    test("the floor clamps at -10 and pays exactly the fixed wage", () => {
        const pay = computePay(R, -12);
        expect(pay.adjustment_percent).toBe(-10);
        expect(pay.allowance.toNumber()).toBe(0);
        expect(pay.total_pay.toNumber()).toBe(13500);
    });

    test("the ceiling clamps at +20", () => {
        const pay = computePay(R, 24);
        expect(pay.adjustment_percent).toBe(20);
        expect(pay.allowance.toNumber()).toBe(4500);
        expect(pay.total_pay.toNumber()).toBe(18000);
    });

    test("the contractual wage is never reduced, however bad the month", () => {
        for (const sum of [-50, -11, -10, -1, 0]) {
            expect(computePay(R, sum).total_pay.greaterThanOrEqualTo(13500)).toBe(true);
        }
    });

    test("fixed wage is 0.9 × R, rounded to whole taka", () => {
        expect(fixedWageFor(15000).toNumber()).toBe(13500);
        expect(fixedWageFor(5000).toNumber()).toBe(4500);
        expect(fixedWageFor(12345).toNumber()).toBe(11111); // 11110.5 rounds up
    });
});

describe("referenceSalaryFor", () => {
    test("an employee's own salary wins over the role standard", () => {
        const r = referenceSalaryFor({
            reference_salary: D(12000),
            roleRef: { reference_salary: D(15000) },
        });
        expect(r.toNumber()).toBe(12000);
    });

    test("no override falls back to the role standard", () => {
        const r = referenceSalaryFor({
            reference_salary: null,
            roleRef: { reference_salary: D(15000) },
        });
        expect(r.toNumber()).toBe(15000);
    });

    test("a zero override is honoured, not treated as absent", () => {
        // ?? not ||, so an unpaid intern on 0 does not silently inherit 15,000.
        const r = referenceSalaryFor({
            reference_salary: D(0),
            roleRef: { reference_salary: D(15000) },
        });
        expect(r.toNumber()).toBe(0);
    });

    test("the resolved figure drives computePay exactly as a raw salary did", () => {
        const resolved = referenceSalaryFor({
            reference_salary: null,
            roleRef: { reference_salary: D(15000) },
        });
        const pay = computePay(resolved, 0);
        expect(pay.fixed_wage.toNumber()).toBe(13500);
        expect(pay.allowance.toNumber()).toBe(1500);
        expect(pay.total_pay.toNumber()).toBe(15000);
    });
});
