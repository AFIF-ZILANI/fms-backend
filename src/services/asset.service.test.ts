import { describe, test, expect, afterAll } from "bun:test";
import prisma from "@lib/db";
import { AssetService } from "./asset.service";
import { StockUnitService } from "./stock-unit.service";
import { AppError } from "@lib/app-error";

const createdAssetIds: string[] = [];
const createdUnitIds: string[] = [];

describe("AssetService", () => {
    afterAll(async () => {
        await prisma.asset.deleteMany({ where: { id: { in: createdAssetIds } } });
        await prisma.stockUnit.deleteMany({ where: { id: { in: createdUnitIds } } });
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
});
