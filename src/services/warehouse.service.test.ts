import { describe, test, expect, afterAll } from "bun:test";
import prisma from "@lib/db";
import { WarehouseService } from "./warehouse.service";
import { AppError } from "@lib/app-error";

const createdIds: string[] = [];

describe("WarehouseService", () => {
    afterAll(async () => {
        await prisma.warehouses.deleteMany({ where: { id: { in: createdIds } } });
    });

    test("create then getById round-trips", async () => {
        const warehouse = await WarehouseService.create({ name: "Main Store" });
        createdIds.push(warehouse.id);

        const found = await WarehouseService.getById(warehouse.id);
        expect(found.name).toBe("Main Store");
    });

    test("getById on unknown id throws not-found", async () => {
        await expect(
            WarehouseService.getById("00000000-0000-0000-0000-000000000000"),
        ).rejects.toBeInstanceOf(AppError);
    });

    test("update renames", async () => {
        const warehouse = await WarehouseService.create({ name: "Old Name" });
        createdIds.push(warehouse.id);

        const updated = await WarehouseService.update(warehouse.id, { name: "New Name" });
        expect(updated.name).toBe("New Name");
    });

    test("update with no fields throws bad-request", async () => {
        const warehouse = await WarehouseService.create({ name: "Untouched" });
        createdIds.push(warehouse.id);

        await expect(WarehouseService.update(warehouse.id, {})).rejects.toMatchObject({
            status: 400,
        });
    });

    test("getStock returns nonzero item balances at this warehouse only", async () => {
        const warehouse = await WarehouseService.create({ name: `Stock Test Warehouse ${crypto.randomUUID()}` });
        createdIds.push(warehouse.id);
        const item = await prisma.item.create({
            data: {
                name: `Warehouse Stock Item ${crypto.randomUUID()}`,
                normalized_key: `warehouse stock item ${crypto.randomUUID()}`,
                category: "FEED",
                unit: "G",
            },
        });
        await prisma.stockLedger.create({
            data: {
                item_id: item.id, quantity: 300, direction: "IN", reason: "PURCHASE",
                ref_type: "PURCHASE", ref_id: crypto.randomUUID(), idempotency_key: crypto.randomUUID(),
                location_type: "WAREHOUSE", location_id: warehouse.id,
            },
        });

        const stock = await WarehouseService.getStock(warehouse.id);
        expect(stock).toHaveLength(1);
        expect(stock[0]!.item_id).toBe(item.id);
        expect(stock[0]!.item_name).toBe(item.name);
        expect(stock[0]!.balance.toNumber()).toBe(300);

        await prisma.stockLedger.deleteMany({ where: { item_id: item.id } });
        await prisma.item.delete({ where: { id: item.id } });
    });

    test("getStock throws not-found for an unknown warehouse", async () => {
        await expect(
            WarehouseService.getStock("00000000-0000-0000-0000-000000000000"),
        ).rejects.toBeInstanceOf(AppError);
    });
});
