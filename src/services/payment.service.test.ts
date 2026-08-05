import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { PaymentService } from "./payment.service";
import { PaymentInstrumentService } from "./payment-instrument.service";
import { AppError } from "@lib/app-error";

let fromInstrumentId: string;
let toInstrumentId: string;
const createdPaymentIds: string[] = [];
const createdInstrumentIds: string[] = [];

describe("PaymentService", () => {
    beforeAll(async () => {
        const from = await PaymentInstrumentService.create({
            owner_type: "CUSTOMER",
            owner_id: crypto.randomUUID(),
            type: "CASH",
            label: "Customer Cash",
        });
        const to = await PaymentInstrumentService.create({
            owner_type: "ADMIN",
            owner_id: crypto.randomUUID(),
            type: "BANK_TRANSFER",
            label: "Farm Bank",
        });
        fromInstrumentId = from.id;
        toInstrumentId = to.id;
        createdInstrumentIds.push(from.id, to.id);
    });

    afterAll(async () => {
        await prisma.payment.deleteMany({ where: { id: { in: createdPaymentIds } } });
        await prisma.paymentInstrument.deleteMany({ where: { id: { in: createdInstrumentIds } } });
    });

    test("create then getById round-trips", async () => {
        const refId = crypto.randomUUID();
        const payment = await PaymentService.create({
            amount: 5000,
            payment_date: new Date(),
            direction: "INCOMING",
            ref_type: "SALE",
            ref_id: refId,
            from_instrument_id: fromInstrumentId,
            to_instrument_id: toInstrumentId,
        });
        createdPaymentIds.push(payment!.id);

        const found = await PaymentService.getById(payment!.id);
        expect(found.amount.toNumber()).toBe(5000);
        expect(found.direction).toBe("INCOMING");
    });

    test("create with a nonexistent from_instrument_id throws bad-request, not a raw 500", async () => {
        await expect(
            PaymentService.create({
                amount: 100,
                payment_date: new Date(),
                direction: "OUTGOING",
                ref_type: "EXPENSE",
                ref_id: crypto.randomUUID(),
                from_instrument_id: "00000000-0000-0000-0000-000000000000",
            }),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("getById on unknown id throws not-found", async () => {
        await expect(
            PaymentService.getById("00000000-0000-0000-0000-000000000000"),
        ).rejects.toBeInstanceOf(AppError);
    });

    test("getTotalPaidForRef sums multiple payments against the same ref", async () => {
        const refId = crypto.randomUUID();
        const p1 = await PaymentService.create({
            amount: 300,
            payment_date: new Date(),
            direction: "OUTGOING",
            ref_type: "PURCHASE",
            ref_id: refId,
            from_instrument_id: fromInstrumentId,
        });
        const p2 = await PaymentService.create({
            amount: 200,
            payment_date: new Date(),
            direction: "OUTGOING",
            ref_type: "PURCHASE",
            ref_id: refId,
            from_instrument_id: fromInstrumentId,
        });
        createdPaymentIds.push(p1!.id, p2!.id);

        const result = await PaymentService.getTotalPaidForRef("PURCHASE", refId);
        expect(result.total_paid.toNumber()).toBe(500);
    });

    test("instrument balance reflects incoming minus outgoing", async () => {
        const refId = crypto.randomUUID();
        const payment = await PaymentService.create({
            amount: 1000,
            payment_date: new Date(),
            direction: "INCOMING",
            ref_type: "BIRD_SALE",
            ref_id: refId,
            from_instrument_id: fromInstrumentId,
            to_instrument_id: toInstrumentId,
        });
        createdPaymentIds.push(payment!.id);

        const balance = await PaymentInstrumentService.getBalance(toInstrumentId);
        expect(balance.incoming.toNumber()).toBeGreaterThanOrEqual(1000);
        expect(balance.balance.toNumber()).toBeGreaterThanOrEqual(1000);
    });
});
