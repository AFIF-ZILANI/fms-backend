import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { PurchaseService, PurchaseItemService } from "./purchase.service";
import { StockUnitService } from "./stock-unit.service";
import { AppError } from "@lib/app-error";
import { createPurchaseSchema } from "@validators/purchase.validator";

const createdPurchaseIds: string[] = [];
const createdItemIds: string[] = [];
const createdItemUnitIds: string[] = [];
let itemId: string;
let profileId: string;
let supplierId: string;
let warehouseId: string;

describe("PurchaseService", () => {
    beforeAll(async () => {
        const item = await prisma.item.create({
            data: {
                name: `Purchase Test Item ${crypto.randomUUID()}`,
                normalized_key: `purchase test item ${crypto.randomUUID()}`,
                category: "MEDICINE",
                unit: "BOTTLE",
                is_unit_tracked: true,
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
            data: { profile_id: supplierProfile.id, role: "DISTRIBUTOR" },
        });
        supplierId = supplier.id;

        const warehouse = await prisma.warehouses.create({
            data: { name: `Purchase Test Warehouse ${crypto.randomUUID()}` },
        });
        warehouseId = warehouse.id;
    });

    afterAll(async () => {
        await prisma.purchaseItem.deleteMany({
            where: { purchase_id: { in: createdPurchaseIds } },
        });
        await prisma.purchase.deleteMany({ where: { id: { in: createdPurchaseIds } } });
        // purchases now post StockLedger IN entries against itemId (and every
        // conversion-test item) -- clear those before deleting the items, or the
        // delete trips StockLedger_item_id_fkey.
        await prisma.stockLedger.deleteMany({
            where: { item_id: { in: [itemId, ...createdItemIds] } },
        });
        await prisma.itemUnit.deleteMany({ where: { id: { in: createdItemUnitIds } } });
        await prisma.item.delete({ where: { id: itemId } });
        await prisma.item.deleteMany({ where: { id: { in: createdItemIds } } });
        const supplier = await prisma.suppliers.findUnique({ where: { id: supplierId } });
        await prisma.suppliers.delete({ where: { id: supplierId } });
        await prisma.profiles.deleteMany({
            where: { id: { in: [profileId, supplier!.profile_id] } },
        });
        await prisma.warehouses.delete({ where: { id: warehouseId } });
    });

    test("create computes line totals and purchase total with exact decimal math", async () => {
        const purchase = await PurchaseService.create({
            supplier_id: supplierId,
            warehouse_id: warehouseId,
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
                warehouse_id: warehouseId,
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
                warehouse_id: warehouseId,
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
            warehouse_id: warehouseId,
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
        });
        expect(bound.status).toBe("IN_STOCK");
        expect(bound.purchase_item_id).toBe(purchaseItemId);

        await prisma.stockUnit.delete({ where: { id: unit!.id } });
    });

    test("PurchaseItemService lists lots filtered by item_id", async () => {
        const purchase = await PurchaseService.create({
            warehouse_id: warehouseId,
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

    test("getAll filters by date_from/date_to and item_category", async () => {
        const recentPurchase = await PurchaseService.create({
            supplier_id: supplierId,
            warehouse_id: warehouseId,
            purchase_date: new Date(),
            paid_amount: 0,
            recorded_by_id: profileId,
            items: [{ item_id: itemId, quantity: 1, unit: "BOTTLE", unit_price: 10 }],
        });
        createdPurchaseIds.push(recentPurchase!.id);

        const oldPurchase = await PurchaseService.create({
            supplier_id: supplierId,
            warehouse_id: warehouseId,
            purchase_date: new Date(Date.now() - 10 * 86_400_000),
            paid_amount: 0,
            recorded_by_id: profileId,
            items: [{ item_id: itemId, quantity: 1, unit: "BOTTLE", unit_price: 10 }],
        });
        createdPurchaseIds.push(oldPurchase!.id);

        const { purchases: dateFiltered } = await PurchaseService.getAll({
            page: 1,
            limit: 100,
            date_from: new Date(Date.now() - 86_400_000),
        });
        expect(dateFiltered.some((p) => p.id === recentPurchase!.id)).toBe(true);
        expect(dateFiltered.some((p) => p.id === oldPurchase!.id)).toBe(false);

        // itemId's category is MEDICINE (see beforeAll) -- filtering on it should
        // find these purchases; filtering on a different category should not.
        const { purchases: categoryFiltered } = await PurchaseService.getAll({
            page: 1,
            limit: 100,
            item_category: "MEDICINE",
        });
        expect(categoryFiltered.some((p) => p.id === recentPurchase!.id)).toBe(true);

        const { purchases: wrongCategoryFiltered } = await PurchaseService.getAll({
            page: 1,
            limit: 100,
            item_category: "FEED",
        });
        expect(wrongCategoryFiltered.some((p) => p.id === recentPurchase!.id)).toBe(false);
    });

    test("converts a purchased quantity to the item's base unit and posts a StockLedger IN entry", async () => {
        const kgItem = await prisma.item.create({
            data: {
                name: `Purchase Conversion Item ${crypto.randomUUID()}`,
                normalized_key: `purchase conversion item ${crypto.randomUUID()}`,
                category: "FEED",
                unit: "KG",
            },
        });
        createdItemIds.push(kgItem.id);
        const itemUnit = await prisma.itemUnit.create({
            data: { item_id: kgItem.id, unit: "BAG", factor_to_base: 50 },
        });
        createdItemUnitIds.push(itemUnit.id);

        const purchase = await PurchaseService.create({
            warehouse_id: warehouseId,
            purchase_date: new Date(),
            paid_amount: 0,
            recorded_by_id: profileId,
            items: [{ item_id: kgItem.id, quantity: 2, unit: "BAG", unit_price: 1000 }],
        });
        createdPurchaseIds.push(purchase!.id);

        const purchaseItem = purchase!.items[0]!;
        expect(purchaseItem.quantity.toNumber()).toBe(2);
        expect(purchaseItem.unit).toBe("BAG");
        expect(purchaseItem.base_quantity.toNumber()).toBe(100);

        const ledgerEntry = await prisma.stockLedger.findFirst({
            where: { ref_type: "PURCHASE", ref_id: purchaseItem.id },
        });
        expect(ledgerEntry?.direction).toBe("IN");
        expect(ledgerEntry?.reason).toBe("PURCHASE");
        expect(ledgerEntry?.quantity.toNumber()).toBe(100);
    });

    test("the user's own example: 1010 gross, 10 flat discount, paid in full nets to 1000 due", async () => {
        const purchase = await PurchaseService.create({
            warehouse_id: warehouseId,
            purchase_date: new Date(),
            paid_amount: 1000,
            recorded_by_id: profileId,
            discount_type: "FLAT",
            discount_value: 10,
            items: [{ item_id: itemId, quantity: 1, unit: "BOTTLE", unit_price: 1010 }],
        });
        createdPurchaseIds.push(purchase!.id);

        expect(purchase!.total_amount.toNumber()).toBe(1000);
        expect(purchase!.due_amount.toNumber()).toBe(0);
    });

    test("per-line PERCENT discount nets the line total, and feeds the purchase subtotal", async () => {
        const purchase = await PurchaseService.create({
            warehouse_id: warehouseId,
            purchase_date: new Date(),
            paid_amount: 0,
            recorded_by_id: profileId,
            items: [
                {
                    item_id: itemId,
                    quantity: 10,
                    unit: "BOTTLE",
                    unit_price: 100,
                    discount_type: "PERCENT",
                    discount_value: 10,
                },
            ],
        });
        createdPurchaseIds.push(purchase!.id);

        // 10 * 100 = 1000 gross, 10% off = 900 net
        expect(purchase!.items[0]!.total_price.toNumber()).toBe(900);
        expect(purchase!.total_amount.toNumber()).toBe(900);
    });

    test("line and global discounts stack: line discount nets the line, global discount nets the subtotal", async () => {
        const purchase = await PurchaseService.create({
            warehouse_id: warehouseId,
            purchase_date: new Date(),
            paid_amount: 0,
            recorded_by_id: profileId,
            discount_type: "FLAT",
            discount_value: 50,
            items: [
                {
                    item_id: itemId,
                    quantity: 10,
                    unit: "BOTTLE",
                    unit_price: 100,
                    discount_type: "FLAT",
                    discount_value: 100,
                },
            ],
        });
        createdPurchaseIds.push(purchase!.id);

        // line: 1000 gross - 100 flat = 900 net -> subtotal 900 -> global 50 flat off -> 850
        expect(purchase!.items[0]!.total_price.toNumber()).toBe(900);
        expect(purchase!.total_amount.toNumber()).toBe(850);
    });

    test("a flat discount larger than the amount it discounts throws bad-request", async () => {
        await expect(
            PurchaseService.create({
                warehouse_id: warehouseId,
                purchase_date: new Date(),
                paid_amount: 0,
                recorded_by_id: profileId,
                items: [
                    {
                        item_id: itemId,
                        quantity: 1,
                        unit: "BOTTLE",
                        unit_price: 10,
                        discount_type: "FLAT",
                        discount_value: 11,
                    },
                ],
            }),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("a percent discount over 100 throws bad-request", async () => {
        await expect(
            PurchaseService.create({
                warehouse_id: warehouseId,
                purchase_date: new Date(),
                paid_amount: 0,
                recorded_by_id: profileId,
                discount_type: "PERCENT",
                discount_value: 101,
                items: [{ item_id: itemId, quantity: 1, unit: "BOTTLE", unit_price: 10 }],
            }),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("purchasing in a unit with no ItemUnit conversion row throws bad-request", async () => {
        const kgItem = await prisma.item.create({
            data: {
                name: `Purchase No Conversion Item ${crypto.randomUUID()}`,
                normalized_key: `purchase no conversion item ${crypto.randomUUID()}`,
                category: "FEED",
                unit: "KG",
            },
        });

        await expect(
            PurchaseService.create({
                warehouse_id: warehouseId,
                purchase_date: new Date(),
                paid_amount: 0,
                recorded_by_id: profileId,
                items: [{ item_id: kgItem.id, quantity: 1, unit: "BAG", unit_price: 1000 }],
            }),
        ).rejects.toMatchObject({ status: 400 });

        await prisma.item.delete({ where: { id: kgItem.id } });
    });

    test("createPurchaseSchema rejects a payload with no warehouse_id", () => {
        const result = createPurchaseSchema.safeParse({
            purchase_date: new Date().toISOString(),
            recorded_by_id: crypto.randomUUID(),
            items: [{ item_id: crypto.randomUUID(), quantity: 1, unit: "G", unit_price: 1 }],
        });
        expect(result.success).toBe(false);
    });

    test("create tags the StockLedger entry with the purchase's warehouse", async () => {
        const item = await prisma.item.create({
            data: {
                name: `Warehouse Tag Test ${crypto.randomUUID()}`,
                normalized_key: `warehouse tag test ${crypto.randomUUID()}`,
                category: "FEED",
                unit: "G",
            },
        });
        const warehouse = await prisma.warehouses.create({
            data: { name: `Test Warehouse ${crypto.randomUUID()}` },
        });

        const purchase = await PurchaseService.create({
            warehouse_id: warehouse.id,
            purchase_date: new Date(),
            recorded_by_id: profileId,
            paid_amount: 0,
            items: [{ item_id: item.id, quantity: 10, unit: "G", unit_price: 5 }],
        });

        const entry = await prisma.stockLedger.findFirst({
            where: { ref_type: "PURCHASE", ref_id: purchase!.items[0]!.id },
        });
        expect(entry?.location_type).toBe("WAREHOUSE");
        expect(entry?.location_id).toBe(warehouse.id);

        await prisma.stockLedger.deleteMany({ where: { item_id: item.id } });
        await prisma.purchaseItem.deleteMany({ where: { item_id: item.id } });
        await prisma.purchase.delete({ where: { id: purchase!.id } });
        await prisma.warehouses.delete({ where: { id: warehouse.id } });
        await prisma.item.delete({ where: { id: item.id } });
    });
});
