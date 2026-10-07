import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { houseNumber, sharedWarehouseId } from "@lib/test-fixtures";
import { createPaymentSchema } from "@validators/payment.validator";
import { SaleService } from "./sale.service";
import { PurchaseService } from "./purchase.service";
import { BirdSaleService } from "./bird-sale.service";
import { PaymentService } from "./payment.service";
import { PaymentInstrumentService } from "./payment-instrument.service";
import { AnalyticsService } from "./analytics.service";

// Money paid when a sale or purchase is recorded is a Payment against an account, so balances and the
// cash position see it -- not a number on the record that nothing counts.

let profileId: string;
let walletId: string; // this file's own account, so balance changes are exactly ours
let itemId: string;
let houseId: string;
let batchId: string;
let warehouseId: string;
const saleIds: string[] = [];
const purchaseIds: string[] = [];

const balance = async () => (await PaymentInstrumentService.getBalance(walletId)).balance.toNumber();
const sale = (over: Record<string, unknown> = {}) =>
    SaleService.create({
        sale_date: new Date(),
        paid_amount: 0,
        recorded_by_id: profileId,
        items: [{ item_id: itemId, quantity: 4, unit: "BAG", unit_price: 25 }], // 100
        ...over,
    } as never);

describe("paid when recorded", () => {
    beforeAll(async () => {
        profileId = (await prisma.profiles.create({ data: { name: "Paid At Create", mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`, role: "ADMIN" } })).id;
        walletId = (await prisma.paymentInstrument.create({ data: { owner_type: "ADMIN", owner_id: profileId, type: "CASH", label: "Paid-at-create wallet" } })).id;
        itemId = (await prisma.item.create({ data: { name: `PAC Item ${crypto.randomUUID()}`, normalized_key: `pac item ${crypto.randomUUID()}`, category: "FEED", unit: "BAG" } })).id;
        warehouseId = await sharedWarehouseId();
        houseId = (await prisma.houses.create({ data: { name: "PAC House", type: "GROWER", number: houseNumber() } })).id;
        batchId = (await prisma.batches.create({ data: { batch_code: `PAC-${crypto.randomUUID()}`, breed: "CLASSIC", expected_selling_date: new Date(Date.now() + 30 * 86_400_000), initial_chick_count: 200, init_chicks_avg_wt: 40 } })).id;
        await prisma.batchHouseBalance.create({ data: { batch_id: batchId, house_id: houseId, quantity: 200 } });
    });

    afterAll(async () => {
        await prisma.payment.deleteMany({ where: { OR: [{ from_instrument_id: walletId }, { to_instrument_id: walletId }] } });
        await prisma.birdSale.deleteMany({ where: { batch_id: batchId } });
        // Children first, or the delete trips a foreign key and the rest of the cleanup never runs.
        await prisma.saleItem.deleteMany({ where: { sale_id: { in: saleIds } } });
        await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
        await prisma.stockLedger.deleteMany({ where: { item_id: itemId } });
        await prisma.purchaseItem.deleteMany({ where: { purchase_id: { in: purchaseIds } } });
        await prisma.purchase.deleteMany({ where: { id: { in: purchaseIds } } });
        await prisma.batchHouseBalance.deleteMany({ where: { batch_id: batchId } });
        await prisma.batches.deleteMany({ where: { id: batchId } });
        await prisma.houses.deleteMany({ where: { id: houseId } });
        await prisma.item.deleteMany({ where: { id: itemId } });
        await prisma.paymentInstrument.deleteMany({ where: { id: walletId } });
        await prisma.profiles.deleteMany({ where: { id: profileId } });
    });

    test("a sale with money received must say which account it went into", async () => {
        await expect(sale({ paid_amount: 40 })).rejects.toMatchObject({ status: 400 });
        // Nothing was written by the refused attempt.
        expect(await balance()).toBe(0);
        // No money received, no account needed.
        const unpaid = await sale({ paid_amount: 0 });
        saleIds.push(unpaid!.id);
        expect(unpaid!.due_amount.toNumber()).toBe(100);
    });

    test("the cash lands in the account: balance up for a sale, down for a purchase", async () => {
        const before = await balance();
        const s = await sale({ paid_amount: 40, paid_to_instrument_id: walletId });
        saleIds.push(s!.id);
        expect((await balance()) - before).toBe(40); // money in

        const p = await PurchaseService.create({
            warehouse_id: warehouseId,
            purchase_date: new Date(),
            paid_amount: 25,
            paid_from_instrument_id: walletId,
            recorded_by_id: profileId,
            items: [{ item_id: itemId, quantity: 1, unit: "BAG", unit_price: 50 }],
        });
        purchaseIds.push(p!.id);
        expect((await balance()) - before).toBe(40 - 25); // money out
        expect((await PaymentService.outstandingForRef("PURCHASE", p!.id)).toNumber()).toBe(25);
    });

    test("the dashboard's cash position moves with it", async () => {
        const row = (d: Awaited<ReturnType<typeof AnalyticsService.financialDashboard>>) =>
            d.cash_by_instrument.find((r) => r.instrument_id === walletId)!.balance.toNumber();
        const before = row(await AnalyticsService.financialDashboard({}));
        const s = await sale({ paid_amount: 10, paid_to_instrument_id: walletId });
        saleIds.push(s!.id);
        expect(row(await AnalyticsService.financialDashboard({})) - before).toBe(10);
    });

    test("the rest can still be settled later, and can't overpay", async () => {
        const s = await sale({ paid_amount: 40, paid_to_instrument_id: walletId }); // 100 owed, 40 paid
        saleIds.push(s!.id);
        expect((await PaymentService.outstandingForRef("SALE", s!.id)).toNumber()).toBe(60);

        const later = (amount: number) =>
            PaymentService.create({ amount, payment_date: new Date(), ref_type: "SALE", ref_id: s!.id, to_instrument_id: walletId });
        await expect(later(61)).rejects.toMatchObject({ status: 400 });
        await later(60);
        expect((await PaymentService.outstandingForRef("SALE", s!.id)).toNumber()).toBe(0);
    });

    test("an inactive or unknown account is refused", async () => {
        const dead = await prisma.paymentInstrument.create({ data: { owner_type: "ADMIN", owner_id: profileId, type: "CASH", label: "PAC dead wallet", is_active: false } });
        try {
            await expect(sale({ paid_amount: 5, paid_to_instrument_id: dead.id })).rejects.toMatchObject({ status: 400 });
            await expect(sale({ paid_amount: 5, paid_to_instrument_id: crypto.randomUUID() })).rejects.toMatchObject({ status: 400 });
        } finally {
            await prisma.paymentInstrument.deleteMany({ where: { id: dead.id } });
        }
    });

    test("a bird sale takes the cash into the account and keeps the discount out of what is owed", async () => {
        const before = await balance();
        const b = await BirdSaleService.create({
            batch_id: batchId,
            house_id: houseId,
            sale_date: new Date(),
            grade: "HIGH",
            birds_count: 10,
            dholta_in_g: 0,
            total_katha: 1,
            total_weight: 20,
            net_weight: 20,
            price_per_kg: 10, // 200
            discount_amount: 20, // 180 owed
            paid_amount: 100,
            paid_to_instrument_id: walletId,
            recorded_by_id: profileId,
        });
        expect((await balance()) - before).toBe(100);
        expect(b!.due_amount.toNumber()).toBe(180);
        expect((await PaymentService.outstandingForRef("BIRD_SALE", b!.id)).toNumber()).toBe(80);

        await expect(
            BirdSaleService.create({ batch_id: batchId, house_id: houseId, sale_date: new Date(), grade: "HIGH", birds_count: 1, dholta_in_g: 0, total_katha: 1, total_weight: 2, net_weight: 2, price_per_kg: 10, paid_amount: 5, recorded_by_id: profileId }),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("a payment names an account: outgoing needs its source, incoming may name only where it landed", async () => {
        const base = { amount: 10, payment_date: "2027-01-01", ref_id: crypto.randomUUID() };
        // Out of the farm: must say where from.
        expect(createPaymentSchema.safeParse({ ...base, ref_type: "PURCHASE", to_instrument_id: crypto.randomUUID() }).success).toBe(false);
        expect(createPaymentSchema.safeParse({ ...base, ref_type: "PURCHASE", from_instrument_id: crypto.randomUUID() }).success).toBe(true);
        // Into the farm: a customer has no account of ours to leave, so naming where it landed is enough.
        expect(createPaymentSchema.safeParse({ ...base, ref_type: "SALE", to_instrument_id: crypto.randomUUID() }).success).toBe(true);
        // Neither side named is meaningless.
        expect(createPaymentSchema.safeParse({ ...base, ref_type: "SALE" }).success).toBe(false);
    });

    test("the database refuses a payment that names no account, or an outgoing one with no source", async () => {
        const row = (over: Record<string, unknown>) =>
            prisma.payment.create({
                data: { amount: 5, payment_date: new Date(), ref_type: "SALE", ref_id: crypto.randomUUID(), direction: "INCOMING", ...over } as never,
            });
        await expect((async () => row({}))()).rejects.toThrow();
        await expect((async () => row({ direction: "OUTGOING", ref_type: "PURCHASE", to_instrument_id: walletId }))()).rejects.toThrow();
        const ok = await row({ to_instrument_id: walletId });
        await prisma.payment.delete({ where: { id: ok.id } });
    });
});
