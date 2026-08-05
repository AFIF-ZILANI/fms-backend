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
});
