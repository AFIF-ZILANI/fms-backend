import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { SaleService } from "./sale.service";
import { AppError } from "@lib/app-error";
import { sharedInstrumentId, sharedWarehouseId, seedStock } from "@lib/test-fixtures";
import { PaymentService } from "./payment.service";
import { getItemLocationBalance } from "@lib/stock-balance";

let itemId: string;
let warehouseId: string;
let profileId: string;
const createdSaleIds: string[] = [];
const createdItemIds: string[] = [];

describe("SaleService", () => {
    beforeAll(async () => {
        const item = await prisma.item.create({
            data: {
                name: `Sale Item ${crypto.randomUUID()}`,
                normalized_key: `sale item ${crypto.randomUUID()}`,
                category: "OTHER",
                unit: "BAG",
            },
        });
        itemId = item.id;
        warehouseId = await sharedWarehouseId();
        await seedStock(itemId, warehouseId, 1000);
        const profile = await prisma.profiles.create({
            data: {
                name: "Sale Recorder",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "ADMIN",
            },
        });
        profileId = profile.id;
    });

    afterAll(async () => {
        await prisma.saleItem.deleteMany({ where: { sale_id: { in: createdSaleIds } } });
        await prisma.payment.deleteMany({ where: { ref_id: { in: createdSaleIds } } });
        await prisma.sale.deleteMany({ where: { id: { in: createdSaleIds } } });
        await prisma.stockLedger.deleteMany({ where: { item_id: { in: createdItemIds } } });
        await prisma.item.deleteMany({ where: { id: { in: createdItemIds } } });
        await prisma.stockLedger.deleteMany({ where: { item_id: itemId } });
        await prisma.item.delete({ where: { id: itemId } });
        await prisma.profiles.delete({ where: { id: profileId } });
    });

    test("create computes line totals and sale total with exact decimal math", async () => {
        const sale = await SaleService.create({
            sale_date: new Date(),
            warehouse_id: warehouseId,
            paid_amount: 50,
            paid_to_instrument_id: await sharedInstrumentId(),
            recorded_by_id: profileId,
            items: [
                { item_id: itemId, quantity: 4, unit: "BAG", unit_price: 12.25 },
                { item_id: itemId, quantity: 2, unit: "BAG", unit_price: 8.5 },
            ],
        });
        createdSaleIds.push(sale!.id);

        // 4 * 12.25 = 49.00, 2 * 8.50 = 17.00, total = 66.00
        expect(sale!.total.toNumber()).toBeCloseTo(66.0, 2);
        // Stored as "nothing paid yet": the 50 paid at the till is a Payment into the account, so the cash
        // position sees it, and what is still owed is the stored due minus that payment.
        expect(sale!.paid_amount.toNumber()).toBe(0);
        expect(sale!.due_amount.toNumber()).toBeCloseTo(66.0, 2);
        const payments = await prisma.payment.findMany({ where: { ref_type: "SALE", ref_id: sale!.id } });
        expect(payments).toHaveLength(1);
        expect(payments[0]).toMatchObject({ direction: "INCOMING", from_instrument_id: null });
        expect(payments[0]!.amount.toNumber()).toBe(50);
        expect(payments[0]!.to_instrument_id).toBeTruthy();
        expect((await PaymentService.outstandingForRef("SALE", sale!.id)).toNumber()).toBeCloseTo(16.0, 2);
    });

    test("paid_amount exceeding total throws bad-request", async () => {
        await expect(
            SaleService.create({
                sale_date: new Date(),
            warehouse_id: warehouseId,
                paid_amount: 9999,
                recorded_by_id: profileId,
                items: [{ item_id: itemId, quantity: 1, unit: "BAG", unit_price: 5 }],
            }),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("getById on unknown id throws not-found", async () => {
        await expect(
            SaleService.getById("00000000-0000-0000-0000-000000000000"),
        ).rejects.toBeInstanceOf(AppError);
    });

    test("getAll filters by date_from/date_to and item_category", async () => {
        const medicineItem = await prisma.item.create({
            data: {
                name: `Filter Medicine ${crypto.randomUUID()}`,
                normalized_key: `filter-medicine-${crypto.randomUUID()}`,
                category: "MEDICINE",
                unit: "BOTTLE",
            },
        });
        createdItemIds.push(medicineItem.id);
        await seedStock(medicineItem.id, warehouseId, 10);

        const recentSale = await SaleService.create({
            sale_date: new Date(),
            warehouse_id: warehouseId,
            paid_amount: 0,
            recorded_by_id: profileId,
            items: [{ item_id: medicineItem.id, quantity: 1, unit: "BOTTLE", unit_price: 20 }],
        });
        createdSaleIds.push(recentSale!.id);

        const oldSale = await SaleService.create({
            warehouse_id: warehouseId,
            sale_date: new Date(Date.now() - 10 * 86_400_000),
            paid_amount: 0,
            recorded_by_id: profileId,
            items: [{ item_id: itemId, quantity: 1, unit: "BAG", unit_price: 5 }],
        });
        createdSaleIds.push(oldSale!.id);

        const { sales: dateFiltered } = await SaleService.getAll({
            page: 1,
            limit: 100,
            date_from: new Date(Date.now() - 86_400_000),
        });
        expect(dateFiltered.some((s) => s.id === recentSale!.id)).toBe(true);
        expect(dateFiltered.some((s) => s.id === oldSale!.id)).toBe(false);

        const { sales: categoryFiltered } = await SaleService.getAll({
            page: 1,
            limit: 100,
            item_category: "MEDICINE",
        });
        expect(categoryFiltered.some((s) => s.id === recentSale!.id)).toBe(true);
        expect(categoryFiltered.some((s) => s.id === oldSale!.id)).toBe(false);
    });
    test("summary totals move by exactly the sale just created", async () => {
        const before = await SaleService.summary({});

        const sale = await SaleService.create({
            sale_date: new Date(),
            warehouse_id: warehouseId,
            paid_amount: 20,
            paid_to_instrument_id: await sharedInstrumentId(),
            recorded_by_id: profileId,
            items: [{ item_id: itemId, quantity: 2, unit: "BAG", unit_price: 50 }],
        });
        createdSaleIds.push(sale!.id);

        const after = await SaleService.summary({});
        expect(after.count - before.count).toBe(1);
        expect(parseFloat(after.total_revenue) - parseFloat(before.total_revenue)).toBeCloseTo(100, 2);
        expect(parseFloat(after.total_due) - parseFloat(before.total_due)).toBeCloseTo(80, 2);
    });
});

describe("SaleService stock", () => {
    let wh: string;
    let item: string;
    let actor: string;
    const saleIds: string[] = [];
    const sell = (quantity: number, over: Record<string, unknown> = {}) =>
        SaleService.create({
            sale_date: new Date(),
            warehouse_id: wh,
            paid_amount: 0,
            recorded_by_id: actor,
            items: [{ item_id: item, quantity, unit: "BAG", unit_price: 10 }],
            ...over,
        } as never);
    const onHand = () =>
        prisma.$transaction((tx) => getItemLocationBalance(tx, item, "WAREHOUSE", wh)).then((d) => d.toNumber());

    beforeAll(async () => {
        wh = await sharedWarehouseId();
        item = (await prisma.item.create({ data: { name: `Stock Sale ${crypto.randomUUID()}`, normalized_key: `stock sale ${crypto.randomUUID()}`, category: "OTHER", unit: "BAG" } })).id;
        actor = (await prisma.profiles.create({ data: { name: "Stock Sale Actor", mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`, role: "ADMIN" } })).id;
        await seedStock(item, wh, 10);
    });

    afterAll(async () => {
        await prisma.saleItem.deleteMany({ where: { sale_id: { in: saleIds } } });
        await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
        await prisma.stockLedger.deleteMany({ where: { item_id: item } });
        await prisma.item.delete({ where: { id: item } });
        await prisma.profiles.delete({ where: { id: actor } });
    });

    test("a sale takes its quantity out of the warehouse and links the ledger row to the sale", async () => {
        const s = await sell(4);
        saleIds.push(s!.id);
        expect(await onHand()).toBe(6);
        const out = await prisma.stockLedger.findMany({ where: { ref_type: "SALE", ref_id: s!.id } });
        expect(out).toHaveLength(1);
        expect(out[0]!.direction).toBe("OUT");
    });

    test("selling more than is in stock is refused and writes nothing", async () => {
        const before = await prisma.sale.count();
        await expect(sell(7)).rejects.toMatchObject({ status: 409 });
        expect(await prisma.sale.count()).toBe(before);
        expect(await onHand()).toBe(6);
    });

    test("two lines of one item are checked together", async () => {
        await expect(
            sell(0, { items: [{ item_id: item, quantity: 4, unit: "BAG", unit_price: 10 }, { item_id: item, quantity: 4, unit: "BAG", unit_price: 10 }] }),
        ).rejects.toMatchObject({ status: 409 });
        expect(await onHand()).toBe(6);
    });
});
