import { describe, test, expect } from "bun:test";
import { Prisma } from "../../prisma/generated/prisma/client";
import { completedMonths, proposeBonus } from "./bonus-math";

const D = (n: number | string) => new Prisma.Decimal(n);
const eventDate = new Date("2026-07-15T00:00:00Z");
const base = { religion: null, multiplier: D(1), min_service_months: 12, prorate: true };
const emp = (over: Partial<Parameters<typeof proposeBonus>[1]> = {}) => ({
    employment_status: "CONFIRMED",
    religion: "ISLAM",
    joining_date: new Date("2025-01-01T00:00:00Z"), // 18 months before the event
    reference_salary: D(15000),
    ...over,
});

describe("completedMonths", () => {
    test("a partial month does not count", () => {
        const joined = new Date("2026-01-15T00:00:00Z");
        expect(completedMonths(joined, new Date("2026-07-14T00:00:00Z"))).toBe(5);
        expect(completedMonths(joined, new Date("2026-07-15T00:00:00Z"))).toBe(6);
    });
    test("never negative when they join after the event", () => {
        expect(completedMonths(new Date("2026-09-01T00:00:00Z"), eventDate)).toBe(0);
    });
    test("spans years", () => {
        expect(completedMonths(new Date("2024-07-15T00:00:00Z"), eventDate)).toBe(24);
    });
});

describe("proposeBonus", () => {
    test("exactly 12 months pays the full multiplier × R, ticked", () => {
        const p = proposeBonus(base, emp({ joining_date: new Date("2025-07-15T00:00:00Z") }), eventDate);
        expect(p.service_months).toBe(12);
        expect(p.proposed_amount.toString()).toBe("15000");
        expect(p).toMatchObject({ selected: true, reason: null });
    });

    test("multiplier scales the amount, on R not on the 0.9 wage", () => {
        const p = proposeBonus({ ...base, multiplier: D("1.5") }, emp(), eventDate);
        expect(p.proposed_amount.toString()).toBe("22500");
    });

    test("under the threshold pays service/12 of the entitlement, rounded, still ticked", () => {
        // 8 months of 15000 = 10000
        const p = proposeBonus(base, emp({ joining_date: new Date("2025-11-15T00:00:00Z") }), eventDate);
        expect(p.service_months).toBe(8);
        expect(p.proposed_amount.toString()).toBe("10000");
        expect(p.selected).toBe(true);
        expect(p.reason).toContain("Prorated");
        // 7 months of 10000 = 5833.33 -> 5833
        const q = proposeBonus(
            base,
            emp({ joining_date: new Date("2025-12-15T00:00:00Z"), reference_salary: D(10000) }),
            eventDate,
        );
        expect(q.proposed_amount.toString()).toBe("5833");
    });

    test("proration divides by 12, not by the threshold: lowering it doesn't raise a short-service payout", () => {
        const joined = new Date("2026-04-15T00:00:00Z"); // 3 months
        const strict = proposeBonus(base, emp({ joining_date: joined }), eventDate);
        const lenient = proposeBonus({ ...base, min_service_months: 6 }, emp({ joining_date: joined }), eventDate);
        expect(strict.proposed_amount.toString()).toBe("3750");
        expect(lenient.proposed_amount.toString()).toBe("3750");
    });

    test("under the threshold with proration off is listed unticked", () => {
        const p = proposeBonus(
            { ...base, prorate: false },
            emp({ joining_date: new Date("2025-11-15T00:00:00Z") }),
            eventDate,
        );
        expect(p.selected).toBe(false);
        expect(p.reason).toContain("Under 12");
    });

    test("religion: match is ticked, mismatch unticked, null never auto-selected", () => {
        const islam = { ...base, religion: "ISLAM" };
        expect(proposeBonus(islam, emp({ religion: "ISLAM" }), eventDate).selected).toBe(true);
        const other = proposeBonus(islam, emp({ religion: "HINDU" }), eventDate);
        expect(other).toMatchObject({ selected: false, reason: "Different religion" });
        const unknown = proposeBonus(islam, emp({ religion: null }), eventDate);
        expect(unknown).toMatchObject({ selected: false, reason: "Religion not recorded" });
    });

    test("a farm-wide event (no religion) selects everyone regardless of religion", () => {
        expect(proposeBonus(base, emp({ religion: null }), eventDate).selected).toBe(true);
        expect(proposeBonus(base, emp({ religion: "HINDU" }), eventDate).selected).toBe(true);
    });

    test("only CONFIRMED employees are ticked", () => {
        const p = proposeBonus(base, emp({ employment_status: "PROBATION" }), eventDate);
        expect(p.selected).toBe(false);
        expect(p.reason).toContain("Not confirmed");
    });
});
