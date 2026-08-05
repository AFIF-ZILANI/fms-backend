import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { BatchService } from "./batch.service";
import { StockUnitService } from "./stock-unit.service";
import { ConsumptionService } from "./consumption.service";
import { AssetDepreciationService } from "./asset-depreciation.service";

let houseId: string;
let profileId: string;
let itemId: string;
let purchaseId: string;
let purchaseItemId: string;
let stockUnitId: string;
let assetId: string;
const createdBatchIds: string[] = [];

describe("AssetDepreciation trigger (Batches.close)", () => {
    beforeAll(async () => {
        const house = await prisma.houses.create({
            data: { name: "Depreciation House", type: "BROODER", number: 1101 },
        });
        houseId = house.id;
        const profile = await prisma.profiles.create({
            data: {
                name: "Depreciation Recorder",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "ADMIN",
            },
        });
        profileId = profile.id;

        const item = await prisma.item.create({
            data: {
                name: `Equipment ${crypto.randomUUID()}`,
                normalized_key: `equipment ${crypto.randomUUID()}`,
                category: "EQUIPMENT",
                unit: "UNIT",
            },
        });
        itemId = item.id;

        const purchase = await prisma.purchase.create({
            data: {
                purchase_date: new Date(),
                total_amount: 10000,
                paid_amount: 10000,
                due_amount: 0,
                recorded_by_id: profile.id,
            },
        });
        purchaseId = purchase.id;
        const purchaseItem = await prisma.purchaseItem.create({
            data: {
                purchase_id: purchase.id,
                item_id: item.id,
                quantity: 1,
                unit: "UNIT",
                unit_price: 10000,
                total_price: 10000,
            },
        });
        purchaseItemId = purchaseItem.id;

        const [unit] = await StockUnitService.provision(1);
        stockUnitId = unit!.id;
        await StockUnitService.bind(unit!.id, { purchase_item_id: purchaseItemId });

        const asset = await prisma.asset.create({
            data: {
                stock_unit_id: unit!.id,
                name: "Brooder Heater",
                purchase_cost: 10000,
                purchase_date: new Date(),
                useful_life_batches: 20,
            },
        });
        assetId = asset.id;
    });

    afterAll(async () => {
        await prisma.assetDepreciation.deleteMany({ where: { asset_id: assetId } });
        await prisma.consumption.deleteMany({ where: { stock_unit_id: stockUnitId } });
        await prisma.asset.delete({ where: { id: assetId } });
        await prisma.stockUnit.delete({ where: { id: stockUnitId } });
        await prisma.purchaseItem.delete({ where: { id: purchaseItemId } });
        await prisma.purchase.delete({ where: { id: purchaseId } });
        await prisma.item.delete({ where: { id: itemId } });
        await prisma.batchHouseBalance.deleteMany({ where: { batch_id: { in: createdBatchIds } } });
        await prisma.batchHouseAllocation.deleteMany({
            where: { batch_id: { in: createdBatchIds } },
        });
        await prisma.batches.deleteMany({ where: { id: { in: createdBatchIds } } });
        await prisma.houses.delete({ where: { id: houseId } });
        await prisma.profiles.delete({ where: { id: profileId } });
    });

    test("closing a batch that consumed the asset's StockUnit computes purchase_cost / useful_life_batches", async () => {
        const batch = await BatchService.create({
            batch_code: `DEP-${crypto.randomUUID()}`,
            breed: "CLASSIC",
            expected_selling_date: new Date(Date.now() + 30 * 86400_000),
            initial_chick_count: 100,
            init_chicks_avg_wt: 40,
            house_id: houseId,
            recorded_by_id: profileId,
        });
        createdBatchIds.push(batch!.id);

        await ConsumptionService.create({
            batch_id: batch!.id,
            house_id: houseId,
            item_id: itemId,
            stock_unit_id: stockUnitId,
            quantity: 1,
            date: new Date(),
            recorded_by_id: profileId,
        });

        await BatchService.close(batch!.id, { status: "CLOSED", force: true });

        const { depreciations } = await AssetDepreciationService.getAll({
            page: 1,
            limit: 10,
            batch_id: batch!.id,
        });
        expect(depreciations.length).toBe(1);
        expect(depreciations[0]!.amount.toNumber()).toBe(500); // 10000 / 20
        expect(depreciations[0]!.asset_id).toBe(assetId);
    });

    test("closing a batch that never touched the asset writes no depreciation row", async () => {
        const batch = await BatchService.create({
            batch_code: `DEP-UNTOUCHED-${crypto.randomUUID()}`,
            breed: "TIGER",
            expected_selling_date: new Date(Date.now() + 30 * 86400_000),
            initial_chick_count: 50,
            init_chicks_avg_wt: 40,
            house_id: houseId,
            recorded_by_id: profileId,
        });
        createdBatchIds.push(batch!.id);

        await BatchService.close(batch!.id, { status: "CLOSED", force: true });

        const { depreciations } = await AssetDepreciationService.getAll({
            page: 1,
            limit: 10,
            batch_id: batch!.id,
        });
        expect(depreciations.length).toBe(0);
    });

    test("closing twice via retry doesn't double-compute (upsert is idempotent)", async () => {
        const batch = await BatchService.create({
            batch_code: `DEP-RETRY-${crypto.randomUUID()}`,
            breed: "FAOMI",
            expected_selling_date: new Date(Date.now() + 30 * 86400_000),
            initial_chick_count: 75,
            init_chicks_avg_wt: 40,
            house_id: houseId,
            recorded_by_id: profileId,
        });
        createdBatchIds.push(batch!.id);

        await ConsumptionService.create({
            batch_id: batch!.id,
            house_id: houseId,
            item_id: itemId,
            stock_unit_id: stockUnitId,
            quantity: 1,
            date: new Date(),
            recorded_by_id: profileId,
        });

        await BatchService.close(batch!.id, { status: "CLOSED", force: true });
        // second close attempt is rejected (not RUNNING anymore) -- confirms
        // the trigger only ever fires once per real close, by construction
        await expect(
            BatchService.close(batch!.id, { status: "CLOSED", force: true }),
        ).rejects.toMatchObject({
            status: 409,
        });

        const { depreciations } = await AssetDepreciationService.getAll({
            page: 1,
            limit: 10,
            batch_id: batch!.id,
        });
        expect(depreciations.length).toBe(1);
    });
});
