import { describe, test, expect, afterAll } from "bun:test";
import prisma from "@lib/db";
import { AssetService } from "./asset.service";
import { StockUnitService } from "./stock-unit.service";
import { AppError } from "@lib/app-error";

const createdAssetIds: string[] = [];
const createdUnitIds: string[] = [];
const createdHouseIds: string[] = [];

describe("AssetService", () => {
    afterAll(async () => {
        await prisma.asset.deleteMany({ where: { id: { in: createdAssetIds } } });
        await prisma.stockUnit.deleteMany({ where: { id: { in: createdUnitIds } } });
        await prisma.houses.deleteMany({ where: { id: { in: createdHouseIds } } });
    });

    test("create then getById round-trips", async () => {
        const [unit] = await StockUnitService.provision(1);
        createdUnitIds.push(unit!.id);

        const asset = await AssetService.create({
            stock_unit_id: unit!.id,
            name: "Incubator",
            purchase_cost: 50000,
            purchase_date: new Date(),
            useful_life_batches: 20,
        });
        createdAssetIds.push(asset!.id);

        const found = await AssetService.getById(asset!.id);
        expect(found.name).toBe("Incubator");
        expect(found.status).toBe("ACTIVE");
        expect(found.stock_unit.id).toBe(unit!.id);
    });

    test("getById includes stock_unit.house when stock unit relocated", async () => {
        const house = await prisma.houses.create({
            data: { name: "Test House", type: "BROODER", number: 1 },
        });
        createdHouseIds.push(house.id);

        const [unit] = await StockUnitService.provision(1);
        createdUnitIds.push(unit!.id);

        await StockUnitService.relocate(unit!.id, house.id);

        const asset = await AssetService.create({
            stock_unit_id: unit!.id,
            name: "Relocated Asset",
            purchase_cost: 25000,
            purchase_date: new Date(),
            useful_life_batches: 15,
        });
        createdAssetIds.push(asset!.id);

        const found = await AssetService.getById(asset!.id);
        expect(found.stock_unit.house?.id).toBe(house.id);
        expect(found.stock_unit.house?.name).toBe("Test House");
    });

    test("duplicate stock_unit_id throws a conflict", async () => {
        const [unit] = await StockUnitService.provision(1);
        createdUnitIds.push(unit!.id);

        const first = await AssetService.create({
            stock_unit_id: unit!.id,
            name: "First Asset",
            purchase_cost: 1000,
            purchase_date: new Date(),
            useful_life_batches: 5,
        });
        createdAssetIds.push(first!.id);

        await expect(
            AssetService.create({
                stock_unit_id: unit!.id,
                name: "Second Asset",
                purchase_cost: 2000,
                purchase_date: new Date(),
                useful_life_batches: 5,
            }),
        ).rejects.toMatchObject({ status: 409 });
    });

    test("getById on unknown id throws not-found", async () => {
        await expect(
            AssetService.getById("00000000-0000-0000-0000-000000000000"),
        ).rejects.toBeInstanceOf(AppError);
    });

    test("setStatus transitions to RETIRED", async () => {
        const [unit] = await StockUnitService.provision(1);
        createdUnitIds.push(unit!.id);

        const asset = await AssetService.create({
            stock_unit_id: unit!.id,
            name: "Retirable",
            purchase_cost: 3000,
            purchase_date: new Date(),
            useful_life_batches: 8,
        });
        createdAssetIds.push(asset!.id);

        const retired = await AssetService.setStatus(asset!.id, "RETIRED");
        expect(retired.status).toBe("RETIRED");
    });

    test("getAll includes depreciations, getById includes depreciations with batch", async () => {
        const [unit] = await StockUnitService.provision(1);
        createdUnitIds.push(unit!.id);

        const asset = await AssetService.create({
            stock_unit_id: unit!.id,
            name: "Depreciation Test Asset",
            purchase_cost: 10000,
            purchase_date: new Date(),
            useful_life_batches: 10,
        });
        createdAssetIds.push(asset!.id);

        // Batches has no direct profile FK (recorded_by lives on BatchHouseAllocation/MortalityLog,
        // not Batches itself) and AssetDepreciation has none either -- no profile fixture needed here.
        const batch = await prisma.batches.create({
            data: {
                batch_code: `ASSET-DEP-${crypto.randomUUID()}`,
                breed: "CLASSIC",
                expected_selling_date: new Date(Date.now() + 30 * 86400_000),
                initial_chick_count: 100,
                init_chicks_avg_wt: 40,
            },
        });
        await prisma.assetDepreciation.create({
            data: { asset_id: asset!.id, batch_id: batch.id, amount: 1000 },
        });

        const { assets } = await AssetService.getAll({ page: 1, limit: 100 });
        const listRow = assets.find((a) => a.id === asset!.id);
        expect(listRow).toBeDefined();
        expect(listRow!.depreciations.length).toBe(1);
        expect(listRow!.depreciations[0]!.amount.toString()).toBe("1000");

        const detail = await AssetService.getById(asset!.id);
        expect(detail.depreciations[0]!.batch.batch_code).toBe(batch.batch_code);

        await prisma.assetDepreciation.deleteMany({ where: { asset_id: asset!.id } });
        await prisma.batches.delete({ where: { id: batch.id } });
    });
});
