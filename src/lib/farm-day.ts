/** The farm runs on Bangladesh time (UTC+6, no daylight saving). */
const FARM_UTC_OFFSET_HOURS = 6;

/**
 * Farm-local hour (0-6) the farm day starts at, from FarmSettings. With 4, a death logged at 01:30 belongs to
 * the previous farm day: the night shift's work stays on the day it started.
 *
 * ponytail: held in memory, loaded at boot and replaced on save (FarmSettingsService). Fine for the single
 * API process; with several processes, reload it per request or on a short TTL.
 */
let dayStartHour = 0;

export const getDayStartHour = (): number => dayStartHour;
export function setDayStartHour(hour: number): void {
    dayStartHour = hour;
}

/** Hours to add to a UTC instant to land on the farm's clock, shifted back by the day-start hour. */
const shiftMs = () => (FARM_UTC_OFFSET_HOURS - dayStartHour) * 3_600_000;

/**
 * The farm calendar day of an instant, as midnight UTC of that day -- the shape a Postgres `date` column
 * round-trips through Prisma. A weighing at 05:00 Dhaka is 23:00 UTC the day before; taking the UTC date
 * would file it under yesterday, where it collides with yesterday's sample.
 *
 * A stored date (midnight UTC = 06:00 Dhaka) stays on its own day because the start hour is capped at 6.
 *
 * ponytail: one timezone, hard-coded. Make it a config value if the farm ever spans timezones.
 */
export function farmDay(instant: Date): Date {
    const local = new Date(instant.getTime() + shiftMs());
    return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
}

/** The instant the current farm day began, for "logged today" queries. */
export const farmDayStart = (now: Date): Date => new Date(farmDay(now).getTime() - shiftMs());

/** Which day of a batch `at` falls on, the farm's way: the placement day is Day 1, the next farm calendar
 * day Day 2. Never below 1. */
export function cycleDay(startingDate: Date, at: Date = new Date()): number {
    const days = Math.round((farmDay(at).getTime() - farmDay(startingDate).getTime()) / 86_400_000);
    return Math.max(1, days + 1);
}
