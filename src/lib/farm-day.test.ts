import { afterEach, describe, test, expect } from "bun:test";
import { cycleDay, farmDay, farmDayStart, setDayStartHour } from "./farm-day";

describe("farmDay", () => {
    test("early morning in Dhaka belongs to that Dhaka day, not the previous UTC day", () => {
        // 05:00 on 7 Oct in Dhaka is 23:00 UTC on 6 Oct.
        expect(farmDay(new Date("2026-10-06T23:00:00Z")).toISOString()).toBe(
            "2026-10-07T00:00:00.000Z",
        );
    });

    test("the Dhaka day rolls over at 18:00 UTC", () => {
        expect(farmDay(new Date("2026-10-07T17:59:59Z")).toISOString()).toBe(
            "2026-10-07T00:00:00.000Z",
        );
        expect(farmDay(new Date("2026-10-07T18:00:00Z")).toISOString()).toBe(
            "2026-10-08T00:00:00.000Z",
        );
    });

    test("a plain YYYY-MM-DD from a client (midnight UTC) stays the same day", () => {
        expect(farmDay(new Date("2026-10-07")).toISOString()).toBe("2026-10-07T00:00:00.000Z");
    });

    test("works across a month and year boundary", () => {
        expect(farmDay(new Date("2026-12-31T20:00:00Z")).toISOString()).toBe(
            "2027-01-01T00:00:00.000Z",
        );
    });
});

describe("cycleDay", () => {
    const placed = new Date("2026-10-25T00:00:00Z"); // stored as midnight UTC of the farm date

    test("the placement day is Day 1, all day long in Dhaka", () => {
        expect(cycleDay(placed, new Date("2026-10-24T18:00:00Z"))).toBe(1); // 00:00 on 25 Oct in Dhaka
        expect(cycleDay(placed, new Date("2026-10-25T17:59:59Z"))).toBe(1); // 23:59 on 25 Oct in Dhaka
    });

    test("ticks over at the farm's midnight", () => {
        expect(cycleDay(placed, new Date("2026-10-25T18:00:00Z"))).toBe(2);
        expect(cycleDay(placed, new Date("2026-11-23T06:00:00Z"))).toBe(30);
    });

    test("never below Day 1", () => {
        expect(cycleDay(placed, new Date("2026-10-20T06:00:00Z"))).toBe(1);
    });
});

describe("farm day starting at 04:00", () => {
    afterEach(() => setDayStartHour(0));
    const placed = new Date("2026-10-25T00:00:00Z");

    test("01:30 Dhaka still belongs to the previous farm day; 04:00 starts the next", () => {
        setDayStartHour(4);
        // 01:30 on 2 Nov in Dhaka = 19:30 UTC on 1 Nov.
        expect(farmDay(new Date("2026-11-01T19:30:00Z")).toISOString()).toBe("2026-11-01T00:00:00.000Z");
        // 03:59 / 04:00 on 2 Nov in Dhaka = 21:59 / 22:00 UTC on 1 Nov.
        expect(farmDay(new Date("2026-11-01T21:59:59Z")).toISOString()).toBe("2026-11-01T00:00:00.000Z");
        expect(farmDay(new Date("2026-11-01T22:00:00Z")).toISOString()).toBe("2026-11-02T00:00:00.000Z");
    });

    test("a stored date stays on its own day at every allowed start hour", () => {
        for (const h of [0, 1, 2, 3, 4, 5, 6]) {
            setDayStartHour(h);
            expect(farmDay(new Date("2026-10-07")).toISOString()).toBe("2026-10-07T00:00:00.000Z");
            expect(cycleDay(placed, placed)).toBe(1);
        }
    });

    test("the batch day ticks over at 04:00, not midnight", () => {
        setDayStartHour(4);
        expect(cycleDay(placed, new Date("2026-10-25T21:59:59Z"))).toBe(1); // 03:59 on 26 Oct in Dhaka
        expect(cycleDay(placed, new Date("2026-10-25T22:00:00Z"))).toBe(2); // 04:00 on 26 Oct in Dhaka
    });

    test("farmDayStart is 04:00 Dhaka of the current farm day", () => {
        setDayStartHour(4);
        // 02:00 on 2 Nov in Dhaka -> farm day 1 Nov, which began 04:00 on 1 Nov Dhaka = 22:00 UTC on 31 Oct.
        expect(farmDayStart(new Date("2026-11-01T20:00:00Z")).toISOString()).toBe("2026-10-31T22:00:00.000Z");
    });
});
