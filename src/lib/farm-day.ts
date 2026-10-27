/** The farm runs on Bangladesh time (UTC+6, no daylight saving). */
const FARM_UTC_OFFSET_HOURS = 6;

/**
 * The farm-local calendar day of an instant, as midnight UTC of that day -- the shape a Postgres
 * `date` column round-trips through Prisma. A weighing at 05:00 Dhaka is 23:00 UTC the day before;
 * taking the UTC date would file it under yesterday, where it collides with yesterday's sample.
 *
 * ponytail: one timezone, hard-coded. Make it a config value if the farm ever spans timezones.
 */
export function farmDay(instant: Date): Date {
    const local = new Date(instant.getTime() + FARM_UTC_OFFSET_HOURS * 3_600_000);
    return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
}

/** Which day of a batch `at` falls on, the farm's way: the placement day is Day 1, the next farm calendar
 * day Day 2. Never below 1. */
export function cycleDay(startingDate: Date, at: Date = new Date()): number {
    const days = Math.round((farmDay(at).getTime() - farmDay(startingDate).getTime()) / 86_400_000);
    return Math.max(1, days + 1);
}
