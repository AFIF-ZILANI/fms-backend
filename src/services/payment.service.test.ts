import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { PaymentService } from "./payment.service";
import { PaymentInstrumentService } from "./payment-instrument.service";
import { AppError } from "@lib/app-error";

let fromInstrumentId: string;
let toInstrumentId: string;
let profileId: string;
let houseId: string;
let batchId: string;
// PaymentService.create validates that the ref actually exists and that the
// amount fits inside its outstanding balance, so every test here needs a real
// record to pay against -- a random ref_id is now a 404, not a payable target.
let saleId: string;
let purchaseId: string;
let birdSaleId: string;
const createdPaymentIds: string[] = [];
const createdInstrumentIds: string[] = [];
const createdSaleIds: string[] = [];

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

        const profile = await prisma.profiles.create({
            data: {
                name: "Payment Recorder",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "ADMIN",
            },
        });
        profileId = profile.id;

        // Rows are created directly rather than through their services: these
        // are payment targets, not subjects under test, and a bare row carries
        // every field the outstanding-balance lookup reads.
        // Dated far outside every analytics window: these exist only to be paid
        // against, and a shared dev database means a fixture inside the last 30
        // days would skew other suites' revenue and price aggregates.
        const longAgo = new Date(Date.now() - 400 * 86_400_000);
        const sale = await prisma.sale.create({
            data: {
                sale_date: longAgo,
                total: 100000,
                paid_amount: 0,
                due_amount: 100000,
                recorded_by_id: profileId,
            },
        });
        saleId = sale.id;
        createdSaleIds.push(sale.id);

        const purchase = await prisma.purchase.create({
            data: {
                purchase_date: longAgo,
                total_amount: 100000,
                paid_amount: 0,
                due_amount: 100000,
                recorded_by_id: profileId,
            },
        });
        purchaseId = purchase.id;

        const house = await prisma.houses.create({
            data: { name: "Payment House", type: "BROODER", number: 9301 },
        });
        houseId = house.id;
        const batch = await prisma.batches.create({
            data: {
                batch_code: `PAYMENT-${crypto.randomUUID()}`,
                breed: "CLASSIC",
                expected_selling_date: new Date(Date.now() + 30 * 86_400_000),
                initial_chick_count: 1000,
                init_chicks_avg_wt: 40,
            },
        });
        batchId = batch.id;
        const birdSale = await prisma.birdSale.create({
            data: {
                batch_id: batchId,
                house_id: houseId,
                sale_date: longAgo,
                grade: "HIGH",
                birds_count: 100,
                dholta_in_g: 0,
                total_katha: 10,
                total_weight: 200,
                net_weight: 200,
                price_per_kg: 500,
                total_amount: 100000,
                paid_amount: 0,
                due_amount: 100000,
                recorded_by_id: profileId,
            },
        });
        birdSaleId = birdSale.id;
    });

    afterAll(async () => {
        // Delete by instrument, not by tracked id: a test that creates a payment
        // it didn't expect to succeed would otherwise leave an untracked row that
        // blocks the instrument delete and aborts the rest of this teardown,
        // leaking fixtures into the shared dev database.
        await prisma.payment.deleteMany({
            where: {
                OR: [
                    { id: { in: createdPaymentIds } },
                    { from_instrument_id: { in: createdInstrumentIds } },
                ],
            },
        });
        await prisma.paymentInstrument.deleteMany({ where: { id: { in: createdInstrumentIds } } });
        await prisma.birdSale.deleteMany({ where: { id: birdSaleId } });
        await prisma.batches.deleteMany({ where: { id: batchId } });
        await prisma.houses.deleteMany({ where: { id: houseId } });
        await prisma.purchase.deleteMany({ where: { id: purchaseId } });
        await prisma.sale.deleteMany({ where: { id: { in: createdSaleIds } } });
        await prisma.profiles.deleteMany({ where: { id: profileId } });
    });

    test("create then getById round-trips", async () => {
        const payment = await PaymentService.create({
            amount: 5000,
            payment_date: new Date(),
            direction: "INCOMING",
            ref_type: "SALE",
            ref_id: saleId,
            from_instrument_id: fromInstrumentId,
            to_instrument_id: toInstrumentId,
        });
        createdPaymentIds.push(payment!.id);

        const found = await PaymentService.getById(payment!.id);
        expect(found.amount.toNumber()).toBe(5000);
        expect(found.direction).toBe("INCOMING");
    });

    // A real ref with room in its balance, so the request reaches the instrument
    // FK -- which is the thing under test here.
    test("create with a nonexistent from_instrument_id throws bad-request, not a raw 500", async () => {
        await expect(
            PaymentService.create({
                amount: 100,
                payment_date: new Date(),
                direction: "OUTGOING",
                ref_type: "SALE",
                ref_id: saleId,
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
        const refId = purchaseId;
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
        const refId = birdSaleId;
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
    async function makeSale(due: number) {
        // Dated far outside every analytics window: these exist only to be paid
        // against, and a shared dev database means a fixture inside the last 30
        // days would skew other suites' revenue and price aggregates.
        const longAgo = new Date(Date.now() - 400 * 86_400_000);
        const sale = await prisma.sale.create({
            data: {
                sale_date: longAgo,
                total: due,
                paid_amount: 0,
                due_amount: due,
                recorded_by_id: profileId,
            },
        });
        createdSaleIds.push(sale.id);
        return sale.id;
    }

    test("rejects a payment larger than the outstanding balance", async () => {
        const id = await makeSale(100);

        await expect(
            PaymentService.create({
                amount: 150,
                payment_date: new Date(),
                direction: "INCOMING",
                ref_type: "SALE",
                ref_id: id,
                from_instrument_id: fromInstrumentId,
            }),
        ).rejects.toThrow("exceeds the outstanding balance");
    });

    test("allows partial payments up to the outstanding balance, then rejects the overflow", async () => {
        const id = await makeSale(100);

        const first = await PaymentService.create({
            amount: 60,
            payment_date: new Date(),
            direction: "INCOMING",
            ref_type: "SALE",
            ref_id: id,
            from_instrument_id: fromInstrumentId,
        });
        createdPaymentIds.push(first!.id);

        expect((await PaymentService.outstandingForRef("SALE", id)).toString()).toBe("40");

        const second = await PaymentService.create({
            amount: 40,
            payment_date: new Date(),
            direction: "INCOMING",
            ref_type: "SALE",
            ref_id: id,
            from_instrument_id: fromInstrumentId,
        });
        createdPaymentIds.push(second!.id);

        expect((await PaymentService.outstandingForRef("SALE", id)).toString()).toBe("0");

        await expect(
            PaymentService.create({
                amount: 1,
                payment_date: new Date(),
                direction: "INCOMING",
                ref_type: "SALE",
                ref_id: id,
                from_instrument_id: fromInstrumentId,
            }),
        ).rejects.toThrow("exceeds the outstanding balance");
    });

    test("rejects a payment against a ref_id that does not exist", async () => {
        await expect(
            PaymentService.create({
                amount: 10,
                payment_date: new Date(),
                direction: "INCOMING",
                ref_type: "SALE",
                ref_id: crypto.randomUUID(),
                from_instrument_id: fromInstrumentId,
            }),
        ).rejects.toThrow("Sale not found");
    });
    test("paidByRef sums every payment per ref, beyond one page of results", async () => {
        const id = await makeSale(30);

        for (const amount of [10, 10, 10]) {
            const payment = await PaymentService.create({
                amount,
                payment_date: new Date(),
                direction: "INCOMING",
                ref_type: "SALE",
                ref_id: id,
                from_instrument_id: fromInstrumentId,
            });
            createdPaymentIds.push(payment!.id);
        }

        const rows = await PaymentService.paidByRef("SALE");
        expect(rows.find((r) => r.ref_id === id)?.total_paid).toBe("30");
    });
});
