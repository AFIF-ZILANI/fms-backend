import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { toBaseQuantity } from "./unit-conversion";
import { AppError } from "@lib/app-error";

let itemId: string;

describe("toBaseQuantity", () => {
    beforeAll(async () => {
        const item = await prisma.item.create({
            data: {
                name: `Unit Conversion Test ${crypto.randomUUID()}`,
                normalized_key: `unit conversion test ${crypto.randomUUID()}`,
                category: "FEED",
                unit: "KG",
            },
        });
        itemId = item.id;
        await prisma.itemUnit.create({
            data: { item_id: itemId, unit: "BAG", factor_to_base: 50, is_purchasable: true, is_usable: true },
        });
        await prisma.itemUnit.create({
            data: { item_id: itemId, unit: "MON_40KG", factor_to_base: 40, is_purchasable: true, is_usable: false },
        });
    });

    afterAll(async () => {
        await prisma.itemUnit.deleteMany({ where: { item_id: itemId } });
        await prisma.item.delete({ where: { id: itemId } });
    });

    test("returns the quantity unchanged when unit already is the base unit", async () => {
        const result = await toBaseQuantity(prisma, itemId, "KG", 12.5, "PURCHASE");
        expect(result.toNumber()).toBe(12.5);
    });

    test("multiplies by factor_to_base when a conversion row exists for that purpose", async () => {
        const result = await toBaseQuantity(prisma, itemId, "BAG", 3, "PURCHASE");
        expect(result.toNumber()).toBe(150);
    });

    test("allows a purchase-and-usable row for the USABLE purpose too", async () => {
        const result = await toBaseQuantity(prisma, itemId, "BAG", 2, "USABLE");
        expect(result.toNumber()).toBe(100);
    });

    test("rejects a purchase-only unit when converting for USABLE purpose", async () => {
        await expect(toBaseQuantity(prisma, itemId, "MON_40KG", 1, "USABLE")).rejects.toMatchObject({
            status: 400,
        });
    });

    test("throws bad-request when no conversion row exists for that unit", async () => {
        await expect(toBaseQuantity(prisma, itemId, "LITER", 1, "PURCHASE")).rejects.toMatchObject({
            status: 400,
        });
    });

    test("throws bad-request for a nonexistent item_id", async () => {
        await expect(
            toBaseQuantity(prisma, "00000000-0000-0000-0000-000000000000", "KG", 1, "PURCHASE"),
        ).rejects.toBeInstanceOf(AppError);
    });
});
