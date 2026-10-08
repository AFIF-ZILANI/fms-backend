import { farmDay } from "@lib/farm-day";

/**
 * The numbers and pure decisions behind the alert scan, kept apart from the database work so each one
 * can be checked on its own and tuned in one place. Every figure here is a starting default for the
 * farm to adjust, not a standard.
 */

const FARM_UTC_OFFSET_MS = 6 * 3_600_000;

/** Which employee roles see an alert. Admins see everything, so an empty list means admin-only. */
export const AUDIENCE = {
    FIELD: ["WORKER", "MANAGER"],
    MANAGER: ["MANAGER"],
    ADMIN: [],
} as const satisfies Record<string, readonly string[]>;

// ── Mortality ────────────────────────────────────────────────────────────────
// Share of a house's live birds that died in 24h.
export const MORTALITY_WARNING_RATE = 0.005;
export const MORTALITY_CRITICAL_RATE = 0.01;

export function mortalityLevel(rate: number): "WARNING" | "CRITICAL" | null {
    if (rate > MORTALITY_CRITICAL_RATE) return "CRITICAL";
    if (rate > MORTALITY_WARNING_RATE) return "WARNING";
    return null;
}

// ── Daily log ────────────────────────────────────────────────────────────────
/** Farm-local hour (0-23) after which a running house with no feed entry today is flagged.
 *  Environment readings are left out until sensor and environment alerts are decided; mortality isn't
 *  required, since a day with no deaths has nothing to log. */
export const DAILY_LOG_CUTOFF_HOUR = 18;

export const farmHour = (now: Date): number =>
    new Date(now.getTime() + FARM_UTC_OFFSET_MS).getUTCHours();

export const pastDailyCutoff = (now: Date): boolean => farmHour(now) >= DAILY_LOG_CUTOFF_HOUR;

/** The instant the farm-local day began, for "logged today" queries. */
export const farmDayStart = (now: Date): Date =>
    new Date(farmDay(now).getTime() - FARM_UTC_OFFSET_MS);

// ── Tasks ────────────────────────────────────────────────────────────────────
/** How long past due before a manager is told. The worker already sees it on their Tasks tab. */
export const TASK_OVERDUE_GRACE_HOURS = 2;

export function overdueByHours(dueAt: Date, now: Date): number {
    return Math.floor((now.getTime() - dueAt.getTime()) / 3_600_000);
}

/** "2026-09" -- the payroll month key. */
export const monthKey = (d: Date): string => d.toISOString().slice(0, 7);

/** "3h" under two days, then "34d" -- a task weeks overdue shouldn't read as "817h". */
export const overdueLabel = (hours: number): string =>
    hours >= 48 ? `${Math.floor(hours / 24)}d` : `${hours}h`;
