import { describe, test, expect } from "bun:test";
import { trendWindow } from "./trend-window";

describe("trendWindow", () => {
    test("the upper bound is the end of today, not the current instant", () => {
        const { lte } = trendWindow(30);
        expect(lte.getUTCHours()).toBe(23);
        expect(lte.getUTCMinutes()).toBe(59);
        // The bug this guards: bounding at `new Date()` drops rows timestamped
        // later today, so every trend under-reports until the day catches up.
        expect(lte.getTime()).toBeGreaterThan(Date.now());
    });

    test("the lower bound is midnight, N days back", () => {
        const { gte } = trendWindow(7);
        expect(gte.getUTCHours()).toBe(0);
        expect(gte.getUTCMinutes()).toBe(0);
        const daysBack = (Date.now() - gte.getTime()) / 86_400_000;
        expect(daysBack).toBeGreaterThan(6.9);
        expect(daysBack).toBeLessThan(8.1);
    });

    test("a row timestamped later today falls inside the window", () => {
        const { gte, lte } = trendWindow(30);
        const laterToday = new Date();
        laterToday.setUTCHours(23, 0, 0, 0);
        expect(laterToday >= gte && laterToday <= lte).toBe(true);
    });
});
