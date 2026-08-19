import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { ItemUnitService } from "./item.service";
import { AppError } from "@lib/app-error";

let itemId: string;
const createdItemUnitIds: string[] = [];

describe("ItemUnitService", () => {
    beforeAll(async () => {
        const item = await prisma.item.create({
            data: {
                name: `Item Unit Test ${crypto.randomUUID()}`,
                normalized_key: `item unit test ${crypto.randomUUID()}`,
                category: "FEED",
                unit: "KG",
            },
        });
        itemId = item.id;
    });

    afterAll(async () => {
        await prisma.itemUnit.deleteMany({ where: { id: { in: createdItemUnitIds } } });
        await prisma.item.delete({ where: { id: itemId } });
    });

    test("create stores the conversion factor", async () => {
        const itemUnit = await ItemUnitService.create({
            item_id: itemId,
            unit: "BAG",
            factor_to_base: 50,
        });
        createdItemUnitIds.push(itemUnit!.id);
        expect(itemUnit!.factor_to_base.toNumber()).toBe(50);
        expect(itemUnit!.item_id).toBe(itemId);
    });

    test("create with a duplicate item_id+unit throws conflict", async () => {
        const itemUnit = await ItemUnitService.create({
            item_id: itemId,
            unit: "LITER",
            factor_to_base: 20,
        });
        createdItemUnitIds.push(itemUnit!.id);

        await expect(
            ItemUnitService.create({ item_id: itemId, unit: "LITER", factor_to_base: 25 }),
        ).rejects.toMatchObject({ status: 409 });
    });

    test("create with a unit equal to the item's own base unit throws bad-request", async () => {
        await expect(
            ItemUnitService.create({ item_id: itemId, unit: "KG", factor_to_base: 1 }),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("create with a nonexistent item_id throws bad-request", async () => {
        await expect(
            ItemUnitService.create({
                item_id: "00000000-0000-0000-0000-000000000000",
                unit: "BAG",
                factor_to_base: 50,
            }),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("remove deletes the row; removing an unknown id throws not-found", async () => {
        const itemUnit = await ItemUnitService.create({
            item_id: itemId,
            unit: "BOX",
            factor_to_base: 12,
        });

        await ItemUnitService.remove(itemUnit!.id);
        const found = await prisma.itemUnit.findUnique({ where: { id: itemUnit!.id } });
        expect(found).toBeNull();

        await expect(ItemUnitService.remove(itemUnit!.id)).rejects.toBeInstanceOf(AppError);
    });
});
