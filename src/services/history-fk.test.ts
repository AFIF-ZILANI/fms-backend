import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { BatchService } from "./batch.service";
import { StockUnitService } from "./stock-unit.service";

// History-bearing foreign keys are RESTRICT: the database, not a count in a service, is what stops a
// delete that would erase or null out history -- including one that races the service's own check.

const mobile = () => `+880${Math.floor(1e9 + Math.random() * 8e9)}`;
let itemId: string;
let warehouseId: string;
let houseId: string;
let profileId: string;
let adminProfileId: string;
let batchId: string;
let unitId: string;

/** Prisma's lazy query isn't a real promise, which `expect(...).rejects` needs. */
const refused = (fn: () => PromiseLike<unknown>) => expect((async () => fn())()).rejects.toThrow();

describe("history foreign keys refuse deletes", () => {
    beforeAll(async () => {
        const [item, warehouse, house, profile, admin] = await Promise.all([
            prisma.item.create({
                data: { name: `FK Item ${crypto.randomUUID()}`, normalized_key: `fk item ${crypto.randomUUID()}`, category: "FEED", unit: "BAG" },
            }),
            prisma.warehouses.create({ data: { name: `FK Warehouse ${crypto.randomUUID()}` } }),
            prisma.houses.create({ data: { name: "FK House", type: "BROODER", number: Math.floor(Math.random() * 1e6) } }),
            prisma.profiles.create({ data: { name: "FK Actor", mobile: mobile(), role: "ADMIN" } }),
            prisma.profiles.create({ data: { name: "FK Admin", mobile: mobile(), role: "ADMIN" } }),
        ]);
        itemId = item.id;
        warehouseId = warehouse.id;
        houseId = house.id;
        profileId = profile.id;
        adminProfileId = admin.id;
        await prisma.admins.create({ data: { profile_id: adminProfileId } });

        // One adjustment at the warehouse and one at the house; a batch placed in the house;
        // a coded unit moved into the house.
        for (const where of [{ warehouse_id: warehouseId }, { house_id: houseId }]) {
            await prisma.inventoryAdjustment.create({
                data: {
                    item_id: itemId,
                    quantity_before: 0,
                    quantity_after: 5,
                    adjustment_quantity: 5,
                    reason: "fk test",
                    recorded_by_id: profileId,
                    idempotency_key: crypto.randomUUID(),
                    ...where,
                },
            });
        }
        const batch = await BatchService.create({
            batch_code: `FK-${crypto.randomUUID()}`,
            breed: "CLASSIC",
            expected_selling_date: new Date(Date.now() + 30 * 86400_000),
            initial_chick_count: 10,
            init_chicks_avg_wt: 40,
            house_id: houseId,
            recorded_by_id: profileId,
        });
        batchId = batch!.id;
        const [unit] = await StockUnitService.provision(1);
        unitId = unit!.id;
        await StockUnitService.relocate(unitId, houseId, crypto.randomUUID());
    });

    afterAll(async () => {
        await prisma.stockHouseAllocation.deleteMany({ where: { stock_unit_id: unitId } });
        await prisma.stockUnit.deleteMany({ where: { id: unitId } });
        await prisma.batchHouseBalance.deleteMany({ where: { batch_id: batchId } });
        await prisma.batchHouseAllocation.deleteMany({ where: { batch_id: batchId } });
        await prisma.batches.deleteMany({ where: { id: batchId } });
        await prisma.inventoryAdjustment.deleteMany({ where: { item_id: itemId } });
        await prisma.admins.deleteMany({ where: { profile_id: adminProfileId } });
        await prisma.item.deleteMany({ where: { id: itemId } });
        await prisma.warehouses.deleteMany({ where: { id: warehouseId } });
        await prisma.houses.deleteMany({ where: { id: houseId } });
        await prisma.profiles.deleteMany({ where: { id: { in: [profileId, adminProfileId] } } });
    });

    test("an item, warehouse or house with adjustments can't be deleted (it used to cascade them away)", async () => {
        await refused(() => prisma.item.delete({ where: { id: itemId } }));
        await refused(() => prisma.warehouses.delete({ where: { id: warehouseId } }));
        await refused(() => prisma.houses.delete({ where: { id: houseId } }));
        expect(await prisma.inventoryAdjustment.count({ where: { item_id: itemId } })).toBe(2);
    });

    test("a batch with bird movements can't be deleted", async () => {
        await refused(() => prisma.batches.delete({ where: { id: batchId } }));
        expect(await prisma.batchHouseAllocation.count({ where: { batch_id: batchId } })).toBeGreaterThan(0);
    });

    test("a house a coded unit was moved to can't be deleted -- the move isn't silently nulled into 'back at the warehouse'", async () => {
        // A house of its own, so the stock allocation is the only thing standing in the way.
        const lone = await prisma.houses.create({
            data: { name: "FK Lone House", type: "BROODER", number: Math.floor(Math.random() * 1e6) },
        });
        try {
            await StockUnitService.relocate(unitId, lone.id, crypto.randomUUID());
            await refused(() => prisma.houses.delete({ where: { id: lone.id } }));
            const latest = await prisma.stockHouseAllocation.findFirstOrThrow({
                where: { stock_unit_id: unitId },
                orderBy: { occurred_at: "desc" },
            });
            expect(latest.house_id).toBe(lone.id);
        } finally {
            await prisma.stockHouseAllocation.deleteMany({ where: { house_id: lone.id } });
            await prisma.houses.deleteMany({ where: { id: lone.id } });
        }
    });

    test("a profile with a role record can't be deleted out from under it", async () => {
        await refused(() => prisma.profiles.delete({ where: { id: adminProfileId } }));
        expect(await prisma.admins.count({ where: { profile_id: adminProfileId } })).toBe(1);
    });
});
