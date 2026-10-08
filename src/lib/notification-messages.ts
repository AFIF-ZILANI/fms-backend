/**
 * The words of each notification, kept apart from the database so they can be checked on their own.
 * Written for the person it is about (second person), plain, with the reason or the amount when there
 * is one. The app picks the icon and the destination from `kind` and `related_id`.
 */

export type NotificationDraft = {
    kind:
        | "TASK_ASSIGNED"
        | "POINTS_GIVEN"
        | "POINTS_VOIDED"
        | "PAYSLIP_READY"
        | "PAYOUT_CONFIRMED"
        | "PAYOUT_FAILED"
        | "BONUS_GRANTED"
        | "PASSWORD_CHANGED"
        | "PASSWORD_RESET";
    title: string;
    body?: string;
    related_id?: string;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "8 Oct, 3:00 pm" on the farm's clock (UTC+6). Built by hand: Intl's wording varies between runtimes. */
export function farmDateTime(d: Date): string {
    const local = new Date(d.getTime() + 6 * 3_600_000);
    const h = local.getUTCHours();
    const mm = String(local.getUTCMinutes()).padStart(2, "0");
    return `${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]}, ${h % 12 || 12}:${mm} ${h < 12 ? "am" : "pm"}`;
}

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const points = (n: number) => `${signed(n)} ${Math.abs(n) === 1 ? "point" : "points"}`;

/** "September 2026" from a payroll month (midnight UTC on the 1st). */
export const monthName = (d: Date): string =>
    `${new Date(Date.UTC(2000, d.getUTCMonth(), 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" })} ${d.getUTCFullYear()}`;

const money = (amount: { toString(): string }) =>
    `৳${Number(amount.toString()).toLocaleString("en-US")}`;

export const taskAssigned = (t: {
    id: string;
    title: string;
    due_at: Date;
}): NotificationDraft => ({
    kind: "TASK_ASSIGNED",
    title: `New task: ${t.title}`,
    body: `Due ${farmDateTime(t.due_at)}`,
    related_id: t.id,
});

export const pointsGiven = (
    e: { id: string; points: number; reason: string },
    givenBy?: string,
): NotificationDraft => ({
    kind: "POINTS_GIVEN",
    title: points(e.points),
    body: givenBy ? `${e.reason} · from ${givenBy}` : e.reason,
    related_id: e.id,
});

export const pointsVoided = (e: { id: string; points: number }): NotificationDraft => ({
    kind: "POINTS_VOIDED",
    title: `A ${points(e.points)} entry was removed`,
    body: "It no longer counts towards your month.",
    related_id: e.id,
});

export const payslipReady = (r: {
    id: string;
    month: Date;
    adjustment_percent: { toString(): string };
}): NotificationDraft => ({
    kind: "PAYSLIP_READY",
    title: `Your ${monthName(r.month)} payslip is ready`,
    body: `Performance adjustment ${Number(r.adjustment_percent.toString()) > 0 ? "+" : ""}${Number(r.adjustment_percent.toString())}%`,
    related_id: r.id,
});

export const payoutConfirmed = (p: {
    id: string;
    amount: { toString(): string };
    method: string;
}): NotificationDraft => ({
    kind: "PAYOUT_CONFIRMED",
    title: "Your payment was sent",
    body: `${money(p.amount)} via ${p.method.toLowerCase()}`,
    related_id: p.id,
});

export const payoutFailed = (p: { id: string }): NotificationDraft => ({
    kind: "PAYOUT_FAILED",
    title: "There was a problem sending your payment",
    body: "Your admin has been told and will sort it out.",
    related_id: p.id,
});

export const bonusGranted = (
    b: { id: string; amount: { toString(): string } },
    eventName: string,
): NotificationDraft => ({
    kind: "BONUS_GRANTED",
    title: "You received a bonus",
    body: `${eventName}: ${money(b.amount)}`,
    related_id: b.id,
});

export const passwordChanged = (): NotificationDraft => ({
    kind: "PASSWORD_CHANGED",
    title: "Your password was changed",
    body: "If this wasn't you, tell your manager right away.",
});

export const passwordReset = (): NotificationDraft => ({
    kind: "PASSWORD_RESET",
    title: "Your password was reset by an admin",
    body: "If you didn't ask for this, tell your manager.",
});
