import { describe, test, expect, afterAll } from "bun:test";
import prisma from "@lib/db";
import { TransferService } from "./transfer.service";

describe("TransferService", () => {
    const createdItemIds: string[] = [];
    const createdWarehouseIds: string[] = [];
    const createdHouseIds: string[] = [];
    const createdProfileIds: string[] = [];
    const createdTransferIds: string[] = [];

    afterAll(async () => {
        await prisma.stockTransfer.deleteMany({ where: { id: { in: createdTransferIds } } });
        await prisma.stockLedger.deleteMany({ where: { item_id: { in: createdItemIds } } });
        await prisma.itemUnit.deleteMany({ where: { item_id: { in: createdItemIds } } });
        await prisma.item.deleteMany({ where: { id: { in: createdItemIds } } });
        await prisma.warehouses.deleteMany({ where: { id: { in: createdWarehouseIds } } });
        await prisma.houses.deleteMany({ where: { id: { in: createdHouseIds } } });
        await prisma.profiles.deleteMany({ where: { id: { in: createdProfileIds } } });
    });

    async function makeFixtures() {
        const item = await prisma.item.create({
            data: {
                name: `Transfer Test Item ${crypto.randomUUID()}`,
                normalized_key: `transfer test item ${crypto.randomUUID()}`,
                category: "FEED",
                unit: "G",
            },
        });
        createdItemIds.push(item.id);
        const warehouse = await prisma.warehouses.create({
            data: { name: `Transfer Test Warehouse ${crypto.randomUUID()}` },
        });
        createdWarehouseIds.push(warehouse.id);
        const house = await prisma.houses.create({
            data: { name: "Transfer Test House", type: "GROWER", number: Math.floor(Math.random() * 100000) },
        });
        createdHouseIds.push(house.id);
        const profile = await prisma.profiles.create({
            data: {
                name: "Transfer Tester",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "ADMIN",
            },
        });
        createdProfileIds.push(profile.id);
        return { item, warehouse, house, profile };
    }

    test("posts a WAREHOUSE OUT and a HOUSE IN entry, both tagged TRANSFER, sharing one ref_id", async () => {
        const { item, warehouse, house, profile } = await makeFixtures();
        await prisma.stockLedger.create({
            data: {
                item_id: item.id, quantity: 100, direction: "IN", reason: "PURCHASE",
                ref_type: "PURCHASE", ref_id: crypto.randomUUID(), idempotency_key: crypto.randomUUID(),
                location_type: "WAREHOUSE", location_id: warehouse.id,
            },
        });

        const transfer = await TransferService.create({
            item_id: item.id,
            from_warehouse_id: warehouse.id,
            to_house_id: house.id,
            quantity: 40,
            unit: "G",
            recorded_by_id: profile.id,
        });
        createdTransferIds.push(transfer!.id);

        const entries = await prisma.stockLedger.findMany({
            where: { ref_type: "TRANSFER", ref_id: transfer!.id },
        });
        expect(entries).toHaveLength(2);
        const out = entries.find((e) => e.direction === "OUT");
        const inn = entries.find((e) => e.direction === "IN");
        expect(out?.location_type).toBe("WAREHOUSE");
        expect(out?.location_id).toBe(warehouse.id);
        expect(inn?.location_type).toBe("HOUSE");
        expect(inn?.location_id).toBe(house.id);
        expect(out?.quantity.toNumber()).toBe(40);
        expect(inn?.quantity.toNumber()).toBe(40);
    });

    test("rejects a quantity exceeding the item's balance at the source warehouse", async () => {
        const { item, warehouse, house, profile } = await makeFixtures();
        // No purchase into this warehouse -- balance is 0.
        await expect(
            TransferService.create({
                item_id: item.id,
                from_warehouse_id: warehouse.id,
                to_house_id: house.id,
                quantity: 10,
                unit: "G",
                recorded_by_id: profile.id,
            }),
        ).rejects.toMatchObject({ status: 409 });
    });

    test("rejects a nonexistent from_warehouse_id with a 404, not a 409", async () => {
        const { item, house, profile } = await makeFixtures();
        await expect(
            TransferService.create({
                item_id: item.id,
                from_warehouse_id: crypto.randomUUID(),
                to_house_id: house.id,
                quantity: 10,
                unit: "G",
                recorded_by_id: profile.id,
            }),
        ).rejects.toMatchObject({ status: 404 });
    });

    test("rejects a unit that isn't usable for the item", async () => {
        const { item, warehouse, house, profile } = await makeFixtures();
        await prisma.itemUnit.create({
            data: { item_id: item.id, unit: "BAG", factor_to_base: 25000, is_purchasable: true, is_usable: false },
        });
        await expect(
            TransferService.create({
                item_id: item.id,
                from_warehouse_id: warehouse.id,
                to_house_id: house.id,
                quantity: 1,
                unit: "BAG",
                recorded_by_id: profile.id,
            }),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("rejects a unit from a different base family", async () => {
        const { item, warehouse, house, profile } = await makeFixtures();
        await expect(
            TransferService.create({
                item_id: item.id,
                from_warehouse_id: warehouse.id,
                to_house_id: house.id,
                quantity: 1,
                unit: "LITER",
                recorded_by_id: profile.id,
            }),
        ).rejects.toMatchObject({ status: 400 });
    });
});
