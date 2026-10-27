import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { purgeAuditLog } from "@lib/test-fixtures";
import { InventoryAdjustmentService } from "./inventory-adjustment.service";
import { PurchaseService } from "./purchase.service";

const itemIds: string[] = [];
let warehouseId: string;
let houseId: string;
let profileId: string;

/** A fresh item per test, so one test's ledger never leaks into another's balance. */
async function newItem(opts: { stockAtWarehouse?: number; unitTracked?: boolean } = {}) {
    const item = await prisma.item.create({
        data: {
            name: `Adjustment Item ${crypto.randomUUID()}`,
            normalized_key: `adjustment item ${crypto.randomUUID()}`,
            category: "FEED",
            unit: "BAG",
            is_unit_tracked: opts.unitTracked ?? false,
        },
    });
    itemIds.push(item.id);
    if (opts.stockAtWarehouse) {
        await prisma.stockLedger.create({
            data: {
                item_id: item.id,
                quantity: opts.stockAtWarehouse,
                direction: "IN",
                reason: "PURCHASE",
                ref_type: "PURCHASE",
                ref_id: crypto.randomUUID(),
                idempotency_key: crypto.randomUUID(),
                location_type: "WAREHOUSE",
                location_id: warehouseId,
            },
        });
    }
    return item;
}

const adjust = (item_id: string, quantity_after: number, over: Record<string, unknown> = {}) =>
    InventoryAdjustmentService.create({
        item_id,
        warehouse_id: warehouseId,
        quantity_after,
        reason: "recount",
        recorded_by_id: profileId,
        ...over,
    });

const ledgerFor = (adjustmentId: string) =>
    prisma.stockLedger.findFirstOrThrow({
        where: { ref_type: "ADJUSTMENT", ref_id: adjustmentId },
    });

describe("InventoryAdjustmentService", () => {
    beforeAll(async () => {
        const [warehouse, house, profile] = await Promise.all([
            prisma.warehouses.create({ data: { name: "Adjustment Warehouse" } }),
            prisma.houses.create({
                data: {
                    name: "Adjustment House",
                    type: "GROWER",
                    number: Math.floor(Math.random() * 100000),
                },
            }),
            prisma.profiles.create({
                data: {
                    name: "Adjustment Recorder",
                    mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                    role: "ADMIN",
                },
            }),
        ]);
        warehouseId = warehouse.id;
        houseId = house.id;
        profileId = profile.id;
    });

    afterAll(async () => {
        await prisma.stockLedger.deleteMany({ where: { item_id: { in: itemIds } } });
        await prisma.inventoryAdjustment.deleteMany({ where: { item_id: { in: itemIds } } });
        await prisma.stockUnit.deleteMany({
            where: { purchase_item: { item_id: { in: itemIds } } },
        });
        await prisma.purchaseItem.deleteMany({ where: { item_id: { in: itemIds } } });
        await prisma.purchase.deleteMany({
            where: { is_opening: true, warehouse_id: warehouseId },
        });
        await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
        await prisma.warehouses.delete({ where: { id: warehouseId } });
        await prisma.houses.delete({ where: { id: houseId } });
        await purgeAuditLog({ where: { changed_by_id: profileId } });
        await prisma.profiles.delete({ where: { id: profileId } });
    });

    test("an upward correction writes an IN entry for the difference from the real balance", async () => {
        const item = await newItem({ stockAtWarehouse: 100 });
        const adjustment = await adjust(item.id, 120);

        expect(adjustment!.quantity_before.toNumber()).toBe(100);
        expect(adjustment!.adjustment_quantity.toNumber()).toBe(20);
        const entry = await ledgerFor(adjustment!.id);
        expect(entry).toMatchObject({ direction: "IN", reason: "ADJUSTMENT" });
        expect(entry.quantity.toNumber()).toBe(20);
    });

    test("a downward correction writes an OUT entry", async () => {
        const item = await newItem({ stockAtWarehouse: 100 });
        const adjustment = await adjust(item.id, 80, { reason: "damaged stock" });

        const entry = await ledgerFor(adjustment!.id);
        expect(entry.direction).toBe("OUT");
        expect(entry.quantity.toNumber()).toBe(20);
    });

    test("the client's quantity_before is ignored -- the ledger decides", async () => {
        const item = await newItem({ stockAtWarehouse: 100 });
        // A stale or mistyped "before" would have posted +75 here and left the ledger off by 75.
        const adjustment = await adjust(item.id, 80, { quantity_before: 5 });

        expect(adjustment!.quantity_before.toNumber()).toBe(100);
        expect(adjustment!.adjustment_quantity.toNumber()).toBe(-20);
        expect((await ledgerFor(adjustment!.id)).direction).toBe("OUT");
    });

    test("a count equal to the real balance is refused", async () => {
        const item = await newItem({ stockAtWarehouse: 50 });
        await expect(adjust(item.id, 50, { reason: "no-op" })).rejects.toMatchObject({
            status: 400,
        });
    });

    test("Wastage and Expired reach the ledger as WASTAGE and EXPIRED, other reasons as ADJUSTMENT", async () => {
        const item = await newItem({ stockAtWarehouse: 100 });
        const wastage = await adjust(item.id, 90, { reason: "Wastage" });
        const expired = await adjust(item.id, 80, { reason: "Expired" });
        const other = await adjust(item.id, 70, { reason: "recount" });

        expect((await ledgerFor(wastage!.id)).reason).toBe("WASTAGE");
        expect((await ledgerFor(expired!.id)).reason).toBe("EXPIRED");
        expect((await ledgerFor(other!.id)).reason).toBe("ADJUSTMENT");
    });

    test("an opening balance works on an empty location and is refused where stock already exists", async () => {
        const item = await newItem();
        const opening = await adjust(item.id, 40, { reason: "Opening balance" });
        expect((await ledgerFor(opening!.id)).reason).toBe("OPENING_BALANCE");
        expect(opening!.quantity_before.toNumber()).toBe(0);

        await expect(adjust(item.id, 90, { reason: "Opening balance" })).rejects.toMatchObject({
            status: 409,
        });
    });

    test("a QR-tracked item's opening balance creates a zero-cost opening lot to bind codes to", async () => {
        const item = await newItem({ unitTracked: true });
        await adjust(item.id, 12, { reason: "Opening balance" });

        const lot = await prisma.purchaseItem.findFirstOrThrow({
            where: { item_id: item.id },
            include: { purchase: true },
        });
        expect(lot.purchase.is_opening).toBe(true);
        expect(lot.purchase.warehouse_id).toBe(warehouseId);
        expect(lot.base_quantity.toNumber()).toBe(12);
        expect(lot.total_price.toNumber()).toBe(0);
        // Only the adjustment posted stock -- the lot adds no second IN.
        expect(await prisma.stockLedger.count({ where: { item_id: item.id } })).toBe(1);
        // Not listed as a purchase.
        const { purchases } = await PurchaseService.getAll({ page: 1, limit: 100 } as never);
        expect(purchases.some((p) => p.id === lot.purchase_id)).toBe(false);
    });

    describe("a later correction keeps the opening lot in step", () => {
        const lotsOf = (item_id: string) =>
            prisma.purchaseItem.findMany({ where: { item_id }, orderBy: { created_at: "asc" } });

        /** An opening lot split into `count` bottles with `linked` of them bound, as Link items leaves it. */
        async function splitLot(item_id: string, count: number, linked: number) {
            const [lot] = await lotsOf(item_id);
            await prisma.purchaseItem.update({
                where: { id: lot!.id },
                data: { unit_count: count },
            });
            await prisma.stockUnit.createMany({
                data: Array.from({ length: linked }, () => ({
                    status: "BOUND" as const,
                    purchase_item_id: lot!.id,
                })),
            });
        }

        test("an unsplit lot takes the corrected size", async () => {
            const item = await newItem({ unitTracked: true });
            await adjust(item.id, 1.6, { reason: "Opening balance" });
            await adjust(item.id, 1.7, { reason: "Data entry correction" });

            const lots = await lotsOf(item.id);
            expect(lots).toHaveLength(1);
            expect(lots[0]!.base_quantity.toNumber()).toBe(1.7);
            expect(lots[0]!.unit_count).toBeNull();
        });

        test("a split lot gains whole bottles: 16 x 0.1 all linked, +0.1 -> 17 bottles, one to link", async () => {
            const item = await newItem({ unitTracked: true });
            await adjust(item.id, 1.6, { reason: "Opening balance" });
            await splitLot(item.id, 16, 16);
            await adjust(item.id, 1.7, { reason: "Data entry correction" });

            const lots = await lotsOf(item.id);
            expect(lots).toHaveLength(1);
            expect(lots[0]!.base_quantity.toNumber()).toBe(1.7);
            expect(lots[0]!.unit_count).toBe(17);
        });

        test("an amount that isn't whole bottles becomes its own unsplit opening lot", async () => {
            const item = await newItem({ unitTracked: true });
            await adjust(item.id, 1.6, { reason: "Opening balance" });
            await splitLot(item.id, 16, 16);
            await adjust(item.id, 1.65, { reason: "Data entry correction" });

            const lots = await lotsOf(item.id);
            expect(lots.map((l) => [l.base_quantity.toNumber(), l.unit_count])).toEqual([
                [1.6, 16],
                [0.05, null],
            ]);
        });

        test("a decrease never drops below the bottles already linked, and makes no lot", async () => {
            const item = await newItem({ unitTracked: true });
            await adjust(item.id, 1.6, { reason: "Opening balance" });
            await splitLot(item.id, 16, 16);
            await adjust(item.id, 1.5, { reason: "Wastage" });

            const lots = await lotsOf(item.id);
            expect(lots.map((l) => [l.base_quantity.toNumber(), l.unit_count])).toEqual([
                [1.6, 16],
            ]);
        });

        test("a decrease removes bottles that haven't been linked yet", async () => {
            const item = await newItem({ unitTracked: true });
            await adjust(item.id, 1.6, { reason: "Opening balance" });
            await splitLot(item.id, 16, 10);
            await adjust(item.id, 1.4, { reason: "Wastage" });

            const [lot] = await lotsOf(item.id);
            expect(lot!.base_quantity.toNumber()).toBe(1.4);
            expect(lot!.unit_count).toBe(14);
        });

        test("an untracked item never gets a lot", async () => {
            const item = await newItem({ stockAtWarehouse: 5 });
            await adjust(item.id, 7);
            expect(await lotsOf(item.id)).toHaveLength(0);
        });
    });

    test("a QR-tracked item's opening balance is refused at a house", async () => {
        const item = await newItem({ unitTracked: true });
        await expect(
            adjust(item.id, 5, {
                reason: "Opening balance",
                warehouse_id: undefined,
                house_id: houseId,
            }),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("an opening balance is refused once the item has stock history anywhere, even at an empty location", async () => {
        const item = await newItem({ stockAtWarehouse: 50 });
        await expect(
            adjust(item.id, 10, {
                reason: "Opening balance",
                warehouse_id: undefined,
                house_id: houseId,
            }),
        ).rejects.toMatchObject({ status: 409 });
    });

    test("when both locations are sent the house wins, and only the house is recorded", async () => {
        const item = await newItem({ stockAtWarehouse: 100 });
        const adjustment = await adjust(item.id, 30, { house_id: houseId });

        expect(adjustment!.house_id).toBe(houseId);
        expect(adjustment!.warehouse_id).toBeNull();
        const entry = await ledgerFor(adjustment!.id);
        expect(entry.location_type).toBe("HOUSE");
        expect(entry.location_id).toBe(houseId);
        // The house had nothing, so +30 there; the warehouse stock is untouched.
        expect(entry.direction).toBe("IN");
        expect(entry.quantity.toNumber()).toBe(30);
    });

    test("create tags the StockLedger entry with the warehouse it was given", async () => {
        const item = await newItem();
        const adjustment = await adjust(item.id, 40, { reason: "Test" });

        const entry = await ledgerFor(adjustment!.id);
        expect(entry.location_type).toBe("WAREHOUSE");
        expect(entry.location_id).toBe(warehouseId);
    });
});
