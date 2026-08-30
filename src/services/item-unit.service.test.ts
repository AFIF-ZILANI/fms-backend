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
            is_purchasable: true,
            is_usable: false,
        });
        createdItemUnitIds.push(itemUnit!.id);
        expect(itemUnit!.factor_to_base.toNumber()).toBe(50);
        expect(itemUnit!.item_id).toBe(itemId);
    });

    test("create with a duplicate item_id+unit throws conflict", async () => {
        const itemUnit = await ItemUnitService.create({
            item_id: itemId,
            unit: "SACHETS",
            factor_to_base: 20,
            is_purchasable: true,
            is_usable: false,
        });
        createdItemUnitIds.push(itemUnit!.id);

        await expect(
            ItemUnitService.create({
                item_id: itemId,
                unit: "SACHETS",
                factor_to_base: 25,
                is_purchasable: true,
                is_usable: false,
            }),
        ).rejects.toMatchObject({ status: 409 });
    });

    test("create with a unit equal to the item's own base unit throws bad-request", async () => {
        await expect(
            ItemUnitService.create({
                item_id: itemId,
                unit: "KG",
                factor_to_base: 1,
                is_purchasable: true,
                is_usable: false,
            }),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("create with a nonexistent item_id throws bad-request", async () => {
        await expect(
            ItemUnitService.create({
                item_id: "00000000-0000-0000-0000-000000000000",
                unit: "BAG",
                factor_to_base: 50,
                is_purchasable: true,
                is_usable: false,
            }),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("create with a unit from a different base-unit family throws bad-request", async () => {
        // ML belongs to the LITER family -- this item's base unit is KG.
        await expect(
            ItemUnitService.create({
                item_id: itemId,
                unit: "ML",
                factor_to_base: 1,
                is_purchasable: true,
                is_usable: false,
            }),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("create with a fixed-factor unit ignores the client's factor_to_base", async () => {
        // G's fixed_factor is 0.001 -- the client sending 1 should be overridden, not honored.
        const itemUnit = await ItemUnitService.create({
            item_id: itemId,
            unit: "G",
            factor_to_base: 1,
            is_purchasable: true,
            is_usable: false,
        });
        createdItemUnitIds.push(itemUnit!.id);
        expect(itemUnit!.factor_to_base.toNumber()).toBe(0.001);
    });

    test("create with a base unit itself (not this item's own) throws bad-request", async () => {
        // PCS is one of the 6 canonical bases -- never addable as a conversion for any item.
        await expect(
            ItemUnitService.create({
                item_id: itemId,
                unit: "PCS",
                factor_to_base: 1,
                is_purchasable: true,
                is_usable: false,
            }),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("create with a legacy unit that has no base_unit and isn't a generic allowlist entry throws bad-request", async () => {
        // BIRD has base_unit=null for unrelated legacy reasons -- must not be treated as generic
        // the way CONTAINER is.
        await expect(
            ItemUnitService.create({
                item_id: itemId,
                unit: "BIRD",
                factor_to_base: 1,
                is_purchasable: true,
                is_usable: false,
            }),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("create with a generic cross-family unit (no base_unit) succeeds", async () => {
        // CONTAINER has no base_unit -- valid for any item's base family, factor stays variable.
        const itemUnit = await ItemUnitService.create({
            item_id: itemId,
            unit: "CONTAINER",
            factor_to_base: 5000,
            is_purchasable: true,
            is_usable: false,
        });
        createdItemUnitIds.push(itemUnit!.id);
        expect(itemUnit!.factor_to_base.toNumber()).toBe(5000);
    });

    test("remove deletes the row; removing an unknown id throws not-found", async () => {
        const itemUnit = await ItemUnitService.create({
            item_id: itemId,
            unit: "MON_40KG",
            factor_to_base: 12,
            is_purchasable: true,
            is_usable: false,
        });

        await ItemUnitService.remove(itemUnit!.id);
        const found = await prisma.itemUnit.findUnique({ where: { id: itemUnit!.id } });
        expect(found).toBeNull();

        await expect(ItemUnitService.remove(itemUnit!.id)).rejects.toBeInstanceOf(AppError);
    });
});
