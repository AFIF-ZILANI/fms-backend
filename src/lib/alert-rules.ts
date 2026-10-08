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
/** Farm-local hour (0-23) after which a house with no feed or environment entry today is flagged.
 *  Mortality isn't required: a day with no deaths has nothing to log. */
export const DAILY_LOG_CUTOFF_HOUR = 18;

export const farmHour = (now: Date): number =>
    new Date(now.getTime() + FARM_UTC_OFFSET_MS).getUTCHours();

export const pastDailyCutoff = (now: Date): boolean => farmHour(now) >= DAILY_LOG_CUTOFF_HOUR;

/** The instant the farm-local day began, for "logged today" queries. */
export const farmDayStart = (now: Date): Date =>
    new Date(farmDay(now).getTime() - FARM_UTC_OFFSET_MS);

export function missingDailyLogs(logged: { environment: boolean; feed: boolean }): string[] {
    const missing: string[] = [];
    if (!logged.environment) missing.push("environment reading");
    if (!logged.feed) missing.push("feed");
    return missing;
}

// ── Environment ──────────────────────────────────────────────────────────────
/** A reading older than this is a missing-log problem, not a current environment problem. */
export const ENV_FRESH_HOURS = 12;

type Metric = "temperature_c" | "humidity_percent" | "ammonia_ppm" | "co2_ppm";
type Limit = {
    label: string;
    unit: string;
    min?: number;
    max?: number;
    level: "WARNING" | "CRITICAL";
};

const COMMON: Record<Exclude<Metric, "temperature_c">, Limit> = {
    humidity_percent: { label: "Humidity", unit: "%", min: 40, max: 75, level: "WARNING" },
    ammonia_ppm: { label: "Ammonia", unit: " ppm", max: 25, level: "CRITICAL" },
    co2_ppm: { label: "CO₂", unit: " ppm", max: 3000, level: "WARNING" },
};

/** Chicks need a hot house; grown birds overheat in it. */
const TEMPERATURE: Record<"BROODER" | "GROWER" | "LAYER", Limit> = {
    BROODER: { label: "Temperature", unit: "°C", min: 28, max: 36, level: "CRITICAL" },
    GROWER: { label: "Temperature", unit: "°C", min: 16, max: 30, level: "CRITICAL" },
    LAYER: { label: "Temperature", unit: "°C", min: 16, max: 30, level: "CRITICAL" },
};

export type EnvReading = Record<Metric, number>;
export type EnvBreach = { metric: Metric; text: string; level: "WARNING" | "CRITICAL" };

/** Which readings fall outside the limits for this kind of house. Empty when all is well. */
export function environmentBreaches(
    reading: EnvReading,
    houseType: keyof typeof TEMPERATURE,
): EnvBreach[] {
    const limits: Record<Metric, Limit> = { temperature_c: TEMPERATURE[houseType], ...COMMON };
    const out: EnvBreach[] = [];
    for (const metric of Object.keys(limits) as Metric[]) {
        const { label, unit, min, max, level } = limits[metric];
        const value = reading[metric];
        const tooLow = min !== undefined && value < min;
        const tooHigh = max !== undefined && value > max;
        if (!tooLow && !tooHigh) continue;
        const range = min !== undefined && max !== undefined ? `${min}–${max}` : `max ${max}`;
        out.push({ metric, level, text: `${label} ${value}${unit} (safe ${range}${unit})` });
    }
    return out;
}

export const worstLevel = (
    breaches: { level: "WARNING" | "CRITICAL" }[],
): "WARNING" | "CRITICAL" =>
    breaches.some((b) => b.level === "CRITICAL") ? "CRITICAL" : "WARNING";

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
