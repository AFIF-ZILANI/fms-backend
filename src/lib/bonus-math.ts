import { Prisma } from "../../prisma/generated/prisma/client";

/**
 * Whole months of service between two dates -- completed ones only, a partial month
 * does not count. Joined 15 Jan, event on 14 Jul = 5; on 15 Jul = 6. Never negative.
 */
export function completedMonths(from: Date, to: Date): number {
    let months =
        (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
    if (to.getUTCDate() < from.getUTCDate()) months -= 1;
    return Math.max(0, months);
}

type EventRules = {
    religion: string | null;
    multiplier: Prisma.Decimal;
    min_service_months: number;
    prorate: boolean;
};

type EmployeeFacts = {
    employment_status: string;
    religion: string | null;
    joining_date: Date;
    /** R, already resolved through referenceSalaryFor(). */
    reference_salary: Prisma.Decimal;
};

export type BonusProposal = {
    service_months: number;
    /** multiplier × R. */
    full_amount: Prisma.Decimal;
    /** What to pay: full, or the prorated share when under the threshold. */
    proposed_amount: Prisma.Decimal;
    /** Ticked by default. False means "listed, owner decides" -- never silently dropped. */
    selected: boolean;
    reason: string | null;
};

/**
 * What the system proposes for one employee at one event (spec: festival-bonus-design.md).
 * Proration always divides by 12, never by min_service_months: it expresses "this share of a
 * year's entitlement", so lowering the threshold must not raise what a short-service employee gets.
 * The caller handles TERMINATED (excluded entirely) and already-granted (shown, not ticked).
 */
export function proposeBonus(event: EventRules, e: EmployeeFacts, eventDate: Date): BonusProposal {
    const service_months = completedMonths(e.joining_date, eventDate);
    const full_amount = event.multiplier.times(e.reference_salary).toDecimalPlaces(0);
    const underService = service_months < event.min_service_months;
    const prorated = event.multiplier
        .times(e.reference_salary)
        .times(service_months)
        .dividedBy(12)
        .toDecimalPlaces(0);
    const proposed_amount = underService && event.prorate ? prorated : full_amount;

    let reason: string | null = null;
    if (e.employment_status !== "CONFIRMED") {
        reason = `Not confirmed yet (${e.employment_status.toLowerCase()})`;
    } else if (event.religion !== null && e.religion === null) {
        // Never auto-selected and never skipped: someone who declined to say must not vanish
        // from their own festival's list.
        reason = "Religion not recorded";
    } else if (event.religion !== null && e.religion !== event.religion) {
        reason = "Different religion";
    } else if (underService && !event.prorate) {
        reason = `Under ${event.min_service_months} months' service`;
    } else if (underService) {
        reason = `Prorated: ${service_months} of ${event.min_service_months} months' service`;
    }

    // A prorated employee is still ticked; every other reason leaves it unticked.
    const prorateOnly = underService && event.prorate && reason?.startsWith("Prorated") === true;
    return { service_months, full_amount, proposed_amount, selected: reason === null || prorateOnly, reason };
}
