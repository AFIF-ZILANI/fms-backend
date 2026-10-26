import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { PurchaseService } from "./purchase.service";
import { getItemAvgCosts } from "@lib/stock-value";
import { sharedInstrumentId, purgeAuditLog } from "@lib/test-fixtures";

// Landed cost: transport/labour on a purchase are split over its lines by value and costed with the stock.
describe("purchase charges (landed cost)", () => {
    const itemIds: string[] = [];
    let profileId: string;
    let warehouseId: string;
    let instrumentId: string;
    let purchaseId: string;

    beforeAll(async () => {
        for (const name of ["Feed", "Mix"]) {
            const item = await prisma.item.create({
                data: {
                    name: `Charge Test ${name} ${crypto.randomUUID()}`,
                    normalized_key: `charge test ${name} ${crypto.randomUUID()}`,
                    category: "FEED",
                    unit: "BAG",
                },
            });
            itemIds.push(item.id);
        }
        profileId = (
            await prisma.profiles.create({
                data: {
                    name: "Charge Recorder",
                    mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                    role: "ADMIN",
                },
            })
        ).id;
        warehouseId = (
            await prisma.warehouses.create({
                data: { name: `Charge Test Warehouse ${crypto.randomUUID()}` },
            })
        ).id;
        instrumentId = await sharedInstrumentId();
    });

    afterAll(async () => {
        const charges = await prisma.expense.findMany({
            where: { purchase_id: purchaseId },
            select: { id: true },
        });
        await prisma.payment.deleteMany({ where: { ref_id: { in: charges.map((c) => c.id) } } });
        await prisma.expense.deleteMany({ where: { purchase_id: purchaseId } });
        await prisma.stockLedger.deleteMany({ where: { item_id: { in: itemIds } } });
        await prisma.purchaseItem.deleteMany({ where: { purchase_id: purchaseId } });
        await prisma.purchase.deleteMany({ where: { id: purchaseId } });
        await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
        await prisma.warehouses.delete({ where: { id: warehouseId } });
        await purgeAuditLog({ where: { changed_by_id: profileId } });
        await prisma.profiles.delete({ where: { id: profileId } });
    });

    test("charges recorded with the purchase are split by value into each item's cost", async () => {
        const purchase = await PurchaseService.create({
            warehouse_id: warehouseId,
            purchase_date: new Date(),
            paid_amount: 0,
            recorded_by_id: profileId,
            // 1000 + 1000 of goods; 200 of charges -> each line carries 100.
            items: [
                { item_id: itemIds[0]!, quantity: 10, unit: "BAG", unit_price: 100 },
                { item_id: itemIds[1]!, quantity: 5, unit: "BAG", unit_price: 200 },
            ],
            charges: [
                {
                    category: "TRANSPORT",
                    amount: 150,
                    paid_amount: 150,
                    paid_from_instrument_id: instrumentId,
                },
                { category: "LABOR", amount: 50 },
            ],
        });
        purchaseId = purchase.id;

        const charges = await prisma.expense.findMany({ where: { purchase_id: purchaseId } });
        expect(charges.map((c) => c.cost_type)).toEqual(["STOCK", "STOCK"]);
        expect(
            await prisma.payment.count({ where: { ref_id: { in: charges.map((c) => c.id) } } }),
        ).toBe(1);

        const avg = await getItemAvgCosts(itemIds);
        expect(avg.get(itemIds[0]!)?.toNumber()).toBe(110); // (1000 + 100) / 10
        expect(avg.get(itemIds[1]!)?.toNumber()).toBe(220); // (1000 + 100) / 5
    });

    test("a late charge re-costs the stock", async () => {
        await PurchaseService.addCharge(purchaseId, {
            category: "TRANSPORT",
            amount: 200,
            recorded_by_id: profileId,
        });
        const avg = await getItemAvgCosts(itemIds);
        expect(avg.get(itemIds[0]!)?.toNumber()).toBe(120); // (1000 + 200) / 10
        expect((await PurchaseService.getById(purchaseId)).charges).toHaveLength(3);
    });

    test("an unknown purchase can't take a charge", async () => {
        await expect(
            PurchaseService.addCharge(crypto.randomUUID(), {
                category: "TRANSPORT",
                amount: 10,
                recorded_by_id: profileId,
            }),
        ).rejects.toMatchObject({ status: 404 });
    });

    test("the database refuses a STOCK expense with no purchase", async () => {
        // async wrapper: a PrismaPromise is lazy and only runs (and rejects) once awaited.
        await expect(
            (async () =>
                prisma.expense.create({
                    data: {
                        category: "TRANSPORT",
                        cost_type: "STOCK",
                        amount: 10,
                        date: new Date(),
                        recorded_by_id: profileId,
                    },
                }))(),
        ).rejects.toThrow(/Expense_stock_is_purchase_charge/);
    });
});
