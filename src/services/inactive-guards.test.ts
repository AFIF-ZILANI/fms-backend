import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { houseNumber } from "@lib/test-fixtures";
import { toBaseQuantity } from "@lib/unit-conversion";
import { ConsumptionService } from "./consumption.service";
import { MortalityLogService } from "./mortality-log.service";
import { TransferService } from "./transfer.service";
import { BatchHouseAllocationService } from "./batch-house-allocation.service";
import { BirdSaleService } from "./bird-sale.service";

// Deactivating is how a used thing is retired, so it has to mean something: no new use or activity.
// Moving things OUT of a deactivated house is allowed (that is how it gets emptied), and a deactivated
// item can still be purchased.

let profileId: string;
let itemId: string;
let deadItemId: string; // deactivated
let warehouseId: string;
let liveHouseId: string;
let deadHouseId: string; // deactivated, still holding birds and stock
let batchId: string;

describe("deactivated items and houses", () => {
    beforeAll(async () => {
        profileId = (await prisma.profiles.create({ data: { name: "Inactive Guard", mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`, role: "ADMIN" } })).id;
        const mkItem = (active: boolean) =>
            prisma.item.create({
                data: { name: `Guard Item ${crypto.randomUUID()}`, normalized_key: `guard item ${crypto.randomUUID()}`, category: "FEED", unit: "BAG", is_active: active },
            });
        itemId = (await mkItem(true)).id;
        deadItemId = (await mkItem(false)).id;
        warehouseId = (await prisma.warehouses.create({ data: { name: `Guard WH ${crypto.randomUUID()}` } })).id;
        liveHouseId = (await prisma.houses.create({ data: { name: "Guard Live", type: "GROWER", number: houseNumber() } })).id;
        deadHouseId = (await prisma.houses.create({ data: { name: "Guard Dead", type: "GROWER", number: houseNumber(), is_active: false } })).id;
        batchId = (
            await prisma.batches.create({
                data: { batch_code: `GUARD-${crypto.randomUUID()}`, breed: "CLASSIC", expected_selling_date: new Date(Date.now() + 30 * 86_400_000), initial_chick_count: 200, init_chicks_avg_wt: 40 },
            })
        ).id;
        for (const house_id of [liveHouseId, deadHouseId]) {
            await prisma.batchHouseBalance.create({ data: { batch_id: batchId, house_id, quantity: 100 } });
        }
        const stock = (location_type: "WAREHOUSE" | "HOUSE", location_id: string) =>
            prisma.stockLedger.create({
                data: { item_id: itemId, quantity: 100, direction: "IN", reason: "PURCHASE", ref_type: "PURCHASE", ref_id: crypto.randomUUID(), idempotency_key: crypto.randomUUID(), location_type, location_id },
            });
        await stock("WAREHOUSE", warehouseId);
        await stock("HOUSE", deadHouseId);
    });

    afterAll(async () => {
        await prisma.birdSale.deleteMany({ where: { batch_id: batchId } });
        await prisma.consumption.deleteMany({ where: { house_id: { in: [liveHouseId, deadHouseId] } } });
        await prisma.mortalityLog.deleteMany({ where: { batch_id: batchId } });
        await prisma.stockTransfer.deleteMany({ where: { item_id: itemId } });
        await prisma.stockLedger.deleteMany({ where: { item_id: { in: [itemId, deadItemId] } } });
        await prisma.batchHouseAllocation.deleteMany({ where: { batch_id: batchId } });
        await prisma.batchHouseBalance.deleteMany({ where: { batch_id: batchId } });
        await prisma.batches.deleteMany({ where: { id: batchId } });
        await prisma.item.deleteMany({ where: { id: { in: [itemId, deadItemId] } } });
        await prisma.warehouses.deleteMany({ where: { id: warehouseId } });
        await prisma.houses.deleteMany({ where: { id: { in: [liveHouseId, deadHouseId] } } });
        await prisma.profiles.deleteMany({ where: { id: profileId } });
    });

    test("a deactivated item can be purchased but not used", async () => {
        await prisma.$transaction(async (tx) => {
            expect((await toBaseQuantity(tx, deadItemId, "BAG", 5, "PURCHASE")).toString()).toBe("5");
        });
        await expect(
            prisma.$transaction((tx) => toBaseQuantity(tx, deadItemId, "BAG", 5, "USABLE")),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("consumption and transfers of a deactivated item are refused", async () => {
        await expect(
            ConsumptionService.create({ house_id: liveHouseId, item_id: deadItemId, quantity: 1, unit: "BAG", date: new Date(), recorded_by_id: profileId }),
        ).rejects.toMatchObject({ status: 400 });
        await expect(
            TransferService.create({ item_id: deadItemId, from_location_type: "WAREHOUSE", from_location_id: warehouseId, to_location_type: "HOUSE", to_location_id: liveHouseId, quantity: 1, unit: "BAG", recorded_by_id: profileId }),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("nothing new is recorded in a deactivated house", async () => {
        await expect(
            ConsumptionService.create({ house_id: deadHouseId, item_id: itemId, quantity: 1, unit: "BAG", date: new Date(), recorded_by_id: profileId }),
        ).rejects.toMatchObject({ status: 400 });
        await expect(
            MortalityLogService.create({ batch_id: batchId, house_id: deadHouseId, count_died: 1, date: new Date(), recorded_by_id: profileId }),
        ).rejects.toMatchObject({ status: 400 });
        await expect(
            BirdSaleService.create({ batch_id: batchId, house_id: deadHouseId, sale_date: new Date(), grade: "HIGH", birds_count: 5, dholta_in_g: 0, total_katha: 1, total_weight: 10, net_weight: 10, price_per_kg: 100, paid_amount: 0, recorded_by_id: profileId }),
        ).rejects.toMatchObject({ status: 400 });
        // ...and the live house beside it is untouched by any of that.
        const balance = await prisma.batchHouseBalance.findFirstOrThrow({ where: { batch_id: batchId, house_id: deadHouseId } });
        expect(balance.quantity).toBe(100);
    });

    test("stock and birds can leave a deactivated house, but not go into one", async () => {
        await expect(
            TransferService.create({ item_id: itemId, from_location_type: "WAREHOUSE", from_location_id: warehouseId, to_location_type: "HOUSE", to_location_id: deadHouseId, quantity: 1, unit: "BAG", recorded_by_id: profileId }),
        ).rejects.toMatchObject({ status: 400 });
        const out = await TransferService.create({ item_id: itemId, from_location_type: "HOUSE", from_location_id: deadHouseId, to_location_type: "WAREHOUSE", to_location_id: warehouseId, quantity: 10, unit: "BAG", recorded_by_id: profileId });
        expect(out!.id).toBeTruthy();

        await expect(
            BatchHouseAllocationService.create({ batch_id: batchId, from_house_id: liveHouseId, to_house_id: deadHouseId, quantity: 5, reason: "TRANSFER", recorded_by_id: profileId }),
        ).rejects.toMatchObject({ status: 400 });
        const moved = await BatchHouseAllocationService.create({ batch_id: batchId, from_house_id: deadHouseId, to_house_id: liveHouseId, quantity: 5, reason: "TRANSFER", recorded_by_id: profileId });
        expect(moved!.quantity).toBe(5);
    });
});
