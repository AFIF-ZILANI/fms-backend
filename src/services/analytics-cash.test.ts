import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { AnalyticsService } from "./analytics.service";
import { PaymentInstrumentService } from "./payment-instrument.service";

// The dashboard computes every instrument's balance with two grouped queries; it must agree
// with the single-instrument getBalance it replaced.

let ownerId: string;
const instrumentIds: string[] = [];

async function newInstrument(label: string) {
    const i = await prisma.paymentInstrument.create({
        data: {
            owner_type: "ADMIN",
            owner_id: ownerId,
            type: "MFS",
            label: `${label} ${crypto.randomUUID()}`,
            mfs_type: "BKASH",
            mobile_no: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
        },
    });
    instrumentIds.push(i.id);
    return i.id;
}

describe("financialDashboard cash_by_instrument", () => {
    beforeAll(async () => {
        const owner = await prisma.profiles.create({
            data: { name: "Cash Owner", mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`, role: "ADMIN" },
        });
        ownerId = owner.id;
    });

    afterAll(async () => {
        await prisma.payment.deleteMany({
            where: { OR: [{ from_instrument_id: { in: instrumentIds } }, { to_instrument_id: { in: instrumentIds } }] },
        });
        await prisma.paymentInstrument.deleteMany({ where: { id: { in: instrumentIds } } });
        await prisma.profiles.delete({ where: { id: ownerId } });
    });

    test("matches getBalance for money in, money out, and an instrument with no payments", async () => {
        const a = await newInstrument("Cash A");
        const b = await newInstrument("Cash B");
        const idle = await newInstrument("Cash Idle");
        const pay = (from: string, to: string | null, amount: number) =>
            prisma.payment.create({
                data: {
                    amount,
                    payment_date: new Date(Date.now() - 400 * 86_400_000),
                    direction: "OUTGOING",
                    ref_type: "EXPENSE",
                    ref_id: crypto.randomUUID(),
                    from_instrument_id: from,
                    ...(to && { to_instrument_id: to }),
                },
            });
        await pay(a, b, 300); // A -> B
        await pay(b, null, 50); // B out
        await pay(a, null, 25.5); // A out, with cents

        const dash = await AnalyticsService.financialDashboard({});
        for (const id of [a, b, idle]) {
            const expected = (await PaymentInstrumentService.getBalance(id)).balance;
            const row = dash.cash_by_instrument.find((r) => r.instrument_id === id);
            expect(row?.balance.toString()).toBe(expected.toString());
        }
        expect(dash.cash_by_instrument.find((r) => r.instrument_id === a)!.balance.toString()).toBe("-325.5");
        expect(dash.cash_by_instrument.find((r) => r.instrument_id === b)!.balance.toString()).toBe("250");
        expect(dash.cash_by_instrument.find((r) => r.instrument_id === idle)!.balance.toString()).toBe("0");
    });
});
