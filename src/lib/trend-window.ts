/**
 * The date range a "last N days" trend covers.
 *
 * The upper bound is the END of today, not `new Date()`. Bounding at the
 * current instant silently drops anything timestamped later today -- a
 * mortality log recorded for 4pm is invisible until 4pm actually arrives, so
 * every trend under-reports through the day and corrects itself at midnight.
 * Offline sync makes this worse: a device with a slightly fast clock writes
 * rows that no chart shows.
 */
export function trendWindow(days: number) {
    const gte = new Date(Date.now() - days * 86_400_000);
    gte.setUTCHours(0, 0, 0, 0);
    const lte = new Date();
    lte.setUTCHours(23, 59, 59, 999);
    return { gte, lte };
}
