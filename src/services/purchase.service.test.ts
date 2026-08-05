import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { PurchaseService, PurchaseItemService } from "./purchase.service";
import { StockUnitService } from "./stock-unit.service";
import { AppError } from "@lib/app-error";

const createdPurchaseIds: string[] = [];
let itemId: string;
let profileId: string;
let supplierId: string;

describe("PurchaseService", () => {
    beforeAll(async () => {
        const item = await prisma.item.create({
            data: {
                name: `Purchase Test Item ${crypto.randomUUID()}`,
                normalized_key: `purchase test item ${crypto.randomUUID()}`,
                category: "MEDICINE",
                unit: "BOTTLE",
            },
        });
        itemId = item.id;

        const profile = await prisma.profiles.create({
            data: {
                name: "Purchase Recorder",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "ADMIN",
            },
        });
        profileId = profile.id;

        const supplierProfile = await prisma.profiles.create({
            data: {
                name: "Purchase Supplier",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "SUPPLIER",
            },
        });
        const supplier = await prisma.suppliers.create({
            data: { profile_id: supplierProfile.id, role: "DISTRIBUTOR", supplies: ["MEDICINE"] },
        });
        supplierId = supplier.id;
    });

    afterAll(async () => {
        await prisma.purchaseItem.deleteMany({
            where: { purchase_id: { in: createdPurchaseIds } },
        });
        await prisma.purchase.deleteMany({ where: { id: { in: createdPurchaseIds } } });
        await prisma.item.delete({ where: { id: itemId } });
        const supplier = await prisma.suppliers.findUnique({ where: { id: supplierId } });
        await prisma.suppliers.delete({ where: { id: supplierId } });
        await prisma.profiles.deleteMany({
            where: { id: { in: [profileId, supplier!.profile_id] } },
        });
    });

    test("create computes line totals and purchase total with exact decimal math", async () => {
        const purchase = await PurchaseService.create({
            supplier_id: supplierId,
            purchase_date: new Date(),
            paid_amount: 100,
            recorded_by_id: profileId,
            items: [
                { item_id: itemId, quantity: 10, unit: "BOTTLE", unit_price: 15.5 },
                { item_id: itemId, quantity: 3, unit: "BOTTLE", unit_price: 9.99 },
            ],
        });
        createdPurchaseIds.push(purchase!.id);

        // 10 * 15.50 = 155.00, 3 * 9.99 = 29.97, total = 184.97
        expect(purchase!.total_amount.toNumber()).toBeCloseTo(184.97, 2);
        expect(purchase!.paid_amount.toNumber()).toBe(100);
        expect(purchase!.due_amount.toNumber()).toBeCloseTo(84.97, 2);
        expect(purchase!.items.length).toBe(2);
        expect(purchase!.items[0]!.total_price.toNumber()).toBeCloseTo(155.0, 2);
    });

    test("paid_amount exceeding total throws bad-request", async () => {
        await expect(
            PurchaseService.create({
                purchase_date: new Date(),
                paid_amount: 10000,
                recorded_by_id: profileId,
                items: [{ item_id: itemId, quantity: 1, unit: "BOTTLE", unit_price: 10 }],
            }),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("create with a nonexistent item_id throws bad-request, not a raw 500", async () => {
        await expect(
            PurchaseService.create({
                purchase_date: new Date(),
                paid_amount: 0,
                recorded_by_id: profileId,
                items: [
                    {
                        item_id: "00000000-0000-0000-0000-000000000000",
                        quantity: 1,
                        unit: "BOTTLE",
                        unit_price: 10,
                    },
                ],
            }),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("getById on unknown id throws not-found", async () => {
        await expect(
            PurchaseService.getById("00000000-0000-0000-0000-000000000000"),
        ).rejects.toBeInstanceOf(AppError);
    });

    test("real PurchaseItem lets StockUnit.bind succeed end to end", async () => {
        const purchase = await PurchaseService.create({
            purchase_date: new Date(),
            paid_amount: 0,
            recorded_by_id: profileId,
            items: [{ item_id: itemId, quantity: 5, unit: "BOTTLE", unit_price: 20 }],
        });
        createdPurchaseIds.push(purchase!.id);
        const purchaseItemId = purchase!.items[0]!.id;

        const [unit] = await StockUnitService.provision(1);
        const bound = await StockUnitService.bind(unit!.id, {
            purchase_item_id: purchaseItemId,
            initial_quantity: 1000,
        });
        expect(bound.status).toBe("IN_STOCK");
        expect(bound.purchase_item_id).toBe(purchaseItemId);

        await prisma.stockUnit.delete({ where: { id: unit!.id } });
    });

    test("PurchaseItemService lists lots filtered by item_id", async () => {
        const purchase = await PurchaseService.create({
            purchase_date: new Date(),
            paid_amount: 0,
            recorded_by_id: profileId,
            items: [{ item_id: itemId, quantity: 2, unit: "BOTTLE", unit_price: 5 }],
        });
        createdPurchaseIds.push(purchase!.id);

        const { purchaseItems } = await PurchaseItemService.getAll({
            page: 1,
            limit: 100,
            item_id: itemId,
        });
        expect(purchaseItems.some((pi) => pi.purchase_id === purchase!.id)).toBe(true);
        expect(purchaseItems.every((pi) => pi.item_id === itemId)).toBe(true);
    });
});
