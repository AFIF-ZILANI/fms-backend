/** Notification wording. Run: `bun src/lib/notification-messages.test.ts`. */
import assert from "node:assert/strict";
import {
    bonusGranted,
    farmDateTime,
    monthName,
    passwordChanged,
    payoutConfirmed,
    payslipReady,
    pointsGiven,
    pointsVoided,
    taskAssigned,
} from "./notification-messages";

// 09:00 UTC is 15:00 in Dhaka.
assert.equal(farmDateTime(new Date("2026-10-08T09:00:00Z")), "8 Oct, 3:00 pm");
assert.equal(monthName(new Date("2026-09-01T00:00:00Z")), "September 2026");

const task = taskAssigned({
    id: "t1",
    title: "Weigh sample",
    due_at: new Date("2026-10-08T09:00:00Z"),
});
assert.equal(task.kind, "TASK_ASSIGNED");
assert.equal(task.title, "New task: Weigh sample");
assert.equal(task.body, "Due 8 Oct, 3:00 pm");
assert.equal(task.related_id, "t1");

assert.equal(
    pointsGiven({ id: "e", points: 3, reason: "Spotted a leak early" }, "Rahim").title,
    "+3 points",
);
assert.equal(
    pointsGiven({ id: "e", points: 3, reason: "Spotted a leak early" }, "Rahim").body,
    "Spotted a leak early · from Rahim",
);
assert.equal(
    pointsGiven({ id: "e", points: -1, reason: "Late" }).title,
    "-1 point",
    "singular, and the sign is kept",
);
assert.equal(
    pointsGiven({ id: "e", points: -1, reason: "Late" }).body,
    "Late",
    "no giver, no 'from'",
);
assert.equal(pointsVoided({ id: "e", points: -2 }).title, "A -2 points entry was removed");

const slip = payslipReady({
    id: "r",
    month: new Date("2026-09-01T00:00:00Z"),
    adjustment_percent: "3",
});
assert.equal(slip.title, "Your September 2026 payslip is ready");
assert.equal(slip.body, "Performance adjustment +3%");
assert.equal(
    payslipReady({ id: "r", month: new Date("2026-09-01T00:00:00Z"), adjustment_percent: "-5" })
        .body,
    "Performance adjustment -5%",
);
assert.equal(
    payslipReady({ id: "r", month: new Date("2026-09-01T00:00:00Z"), adjustment_percent: "0" })
        .body,
    "Performance adjustment 0%",
);

assert.equal(
    payoutConfirmed({ id: "p", amount: "15250.00", method: "BKASH" }).body,
    "৳15,250 via bkash",
);
assert.equal(bonusGranted({ id: "b", amount: "8000" }, "Eid-ul-Fitr").body, "Eid-ul-Fitr: ৳8,000");
assert.equal(passwordChanged().related_id, undefined);

console.log("notification-messages checks passed");
