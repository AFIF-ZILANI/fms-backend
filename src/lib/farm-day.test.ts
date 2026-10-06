import { describe, test, expect } from "bun:test";
import { farmDay } from "./farm-day";

describe("farmDay", () => {
    test("early morning in Dhaka belongs to that Dhaka day, not the previous UTC day", () => {
        // 05:00 on 7 Oct in Dhaka is 23:00 UTC on 6 Oct.
        expect(farmDay(new Date("2026-10-06T23:00:00Z")).toISOString()).toBe("2026-10-07T00:00:00.000Z");
    });

    test("the Dhaka day rolls over at 18:00 UTC", () => {
        expect(farmDay(new Date("2026-10-07T17:59:59Z")).toISOString()).toBe("2026-10-07T00:00:00.000Z");
        expect(farmDay(new Date("2026-10-07T18:00:00Z")).toISOString()).toBe("2026-10-08T00:00:00.000Z");
    });

    test("a plain YYYY-MM-DD from a client (midnight UTC) stays the same day", () => {
        expect(farmDay(new Date("2026-10-07")).toISOString()).toBe("2026-10-07T00:00:00.000Z");
    });

    test("works across a month and year boundary", () => {
        expect(farmDay(new Date("2026-12-31T20:00:00Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
    });
});
