import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { InventoryAdjustmentService } from "./inventory-adjustment.service";

const createdAdjustmentIds: string[] = [];
let itemId: string;
let warehouseId: string;
let profileId: string;

describe("InventoryAdjustmentService", () => {
    beforeAll(async () => {
        const [item, warehouse, profile] = await Promise.all([
            prisma.item.create({
                data: {
                    name: `Adjustment Item ${crypto.randomUUID()}`,
                    normalized_key: `adjustment item ${crypto.randomUUID()}`,
                    category: "FEED",
                    unit: "BAG",
                },
            }),
            prisma.warehouses.create({ data: { name: "Adjustment Warehouse" } }),
            prisma.profiles.create({
                data: {
                    name: "Adjustment Recorder",
                    mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                    role: "ADMIN",
                },
            }),
        ]);
        itemId = item.id;
        warehouseId = warehouse.id;
        profileId = profile.id;
    });

    afterAll(async () => {
        await prisma.stockLedger.deleteMany({ where: { item_id: itemId } });
        await prisma.inventoryAdjustment.deleteMany({
            where: { id: { in: createdAdjustmentIds } },
        });
        await prisma.item.delete({ where: { id: itemId } });
        await prisma.warehouses.delete({ where: { id: warehouseId } });
        await prisma.profiles.delete({ where: { id: profileId } });
    });

    test("an upward correction writes an IN ledger entry", async () => {
        const adjustment = await InventoryAdjustmentService.create({
            item_id: itemId,
            warehouse_id: warehouseId,
            quantity_before: 100,
            quantity_after: 120,
            reason: "recount",
            recorded_by_id: profileId,
        });
        createdAdjustmentIds.push(adjustment!.id);

        expect(adjustment!.adjustment_quantity.toNumber()).toBe(20);

        const ledgerEntry = await prisma.stockLedger.findFirst({
            where: { ref_type: "ADJUSTMENT", ref_id: adjustment!.id },
        });
        expect(ledgerEntry?.direction).toBe("IN");
        expect(ledgerEntry?.quantity.toNumber()).toBe(20);
        expect(ledgerEntry?.reason).toBe("ADJUSTMENT");
    });

    test("a downward correction writes an OUT ledger entry", async () => {
        const adjustment = await InventoryAdjustmentService.create({
            item_id: itemId,
            warehouse_id: warehouseId,
            quantity_before: 100,
            quantity_after: 80,
            reason: "damaged stock",
            recorded_by_id: profileId,
        });
        createdAdjustmentIds.push(adjustment!.id);

        const ledgerEntry = await prisma.stockLedger.findFirst({
            where: { ref_type: "ADJUSTMENT", ref_id: adjustment!.id },
        });
        expect(ledgerEntry?.direction).toBe("OUT");
        expect(ledgerEntry?.quantity.toNumber()).toBe(20);
    });

    test("equal before/after throws bad-request", async () => {
        await expect(
            InventoryAdjustmentService.create({
                item_id: itemId,
                warehouse_id: warehouseId,
                quantity_before: 50,
                quantity_after: 50,
                reason: "no-op",
                recorded_by_id: profileId,
            }),
        ).rejects.toMatchObject({ status: 400 });
    });
});
