/** Alert thresholds and decisions. Run: `bun src/lib/alert-rules.test.ts`. */
import assert from "node:assert/strict";
import {
    AUDIENCE,
    environmentBreaches,
    farmDayStart,
    farmHour,
    missingDailyLogs,
    monthKey,
    mortalityLevel,
    overdueByHours,
    overdueLabel,
    pastDailyCutoff,
    worstLevel,
} from "./alert-rules";

// --- mortality grading ---
assert.equal(mortalityLevel(0.004), null);
assert.equal(mortalityLevel(0.005), null, "exactly the warning line is not over it");
assert.equal(mortalityLevel(0.007), "WARNING");
assert.equal(mortalityLevel(0.011), "CRITICAL");

// --- farm-local cut-off (UTC+6): 12:00 UTC is 18:00 in Dhaka ---
assert.equal(farmHour(new Date("2026-10-08T12:00:00Z")), 18);
assert.equal(pastDailyCutoff(new Date("2026-10-08T11:59:00Z")), false);
assert.equal(pastDailyCutoff(new Date("2026-10-08T12:00:00Z")), true);
// 23:30 UTC is 05:30 the next local day, so not past the cut-off yet.
assert.equal(pastDailyCutoff(new Date("2026-10-08T23:30:00Z")), false);
// The local day that contains 05:00 Dhaka began at 18:00 UTC the day before.
assert.equal(
    farmDayStart(new Date("2026-10-08T23:00:00Z")).toISOString(),
    "2026-10-08T18:00:00.000Z",
);

// --- what's missing ---
assert.deepEqual(missingDailyLogs({ environment: true, feed: true }), []);
assert.deepEqual(missingDailyLogs({ environment: false, feed: true }), ["environment reading"]);
assert.deepEqual(missingDailyLogs({ environment: false, feed: false }), [
    "environment reading",
    "feed",
]);

// --- environment ---
const ok = { temperature_c: 24, humidity_percent: 60, ammonia_ppm: 10, co2_ppm: 1500 };
assert.deepEqual(environmentBreaches(ok, "GROWER"), []);
assert.equal(
    environmentBreaches({ ...ok, temperature_c: 24 }, "BROODER").length,
    1,
    "24C is too cold for chicks",
);
assert.deepEqual(environmentBreaches({ ...ok, temperature_c: 33 }, "BROODER"), []);
const hot = environmentBreaches({ ...ok, temperature_c: 33 }, "GROWER");
assert.equal(hot.length, 1);
assert.equal(hot[0]?.level, "CRITICAL");
assert.match(hot[0]?.text ?? "", /Temperature 33°C \(safe 16–30°C\)/);
const damp = environmentBreaches({ ...ok, humidity_percent: 85 }, "GROWER");
assert.equal(worstLevel(damp), "WARNING");
assert.equal(
    worstLevel([...damp, ...environmentBreaches({ ...ok, ammonia_ppm: 40 }, "GROWER")]),
    "CRITICAL",
);

// --- tasks and months ---
assert.equal(overdueByHours(new Date("2026-10-08T06:00:00Z"), new Date("2026-10-08T09:30:00Z")), 3);
assert.equal(monthKey(new Date("2026-09-01T00:00:00Z")), "2026-09");

assert.equal(overdueLabel(3), "3h");
assert.equal(overdueLabel(47), "47h");
assert.equal(overdueLabel(817), "34d");

// --- audiences ---
assert.deepEqual([...AUDIENCE.ADMIN], [], "admin-only is the empty list");
assert.ok(AUDIENCE.FIELD.includes("WORKER") && AUDIENCE.FIELD.includes("MANAGER"));
assert.ok(!(AUDIENCE.MANAGER as readonly string[]).includes("WORKER"));

console.log("alert-rules checks passed");
