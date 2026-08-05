import { describe, test, expect, afterAll } from "bun:test";
import prisma from "@lib/db";
import { ItemService } from "./item.service";
import { AppError } from "@lib/app-error";

const name = () => `Test Item ${crypto.randomUUID()}`;
const createdIds: string[] = [];

describe("ItemService", () => {
    afterAll(async () => {
        await prisma.item.deleteMany({ where: { id: { in: createdIds } } });
    });

    test("create computes normalized_key and round-trips", async () => {
        const itemName = `  Amoxicillin ${crypto.randomUUID()}  `;
        const item = await ItemService.create({
            name: itemName,
            category: "MEDICINE",
            unit: "BOTTLE",
        });
        createdIds.push(item!.id);

        const found = await ItemService.getById(item!.id);
        expect(found.name).toBe(itemName);
        expect(found.normalized_key).toBe(itemName.trim().toLowerCase());
        expect(found.is_active).toBe(true);
    });

    test("duplicate normalized name throws a conflict", async () => {
        const base = `Feed ${crypto.randomUUID()}`;
        const first = await ItemService.create({ name: base, category: "FEED", unit: "BAG" });
        createdIds.push(first!.id);

        await expect(
            ItemService.create({ name: base.toUpperCase(), category: "FEED", unit: "BAG" }),
        ).rejects.toMatchObject({ status: 409 });
    });

    test("getById on unknown id throws not-found", async () => {
        await expect(
            ItemService.getById("00000000-0000-0000-0000-000000000000"),
        ).rejects.toBeInstanceOf(AppError);
    });

    test("update with no fields throws bad-request", async () => {
        const item = await ItemService.create({ name: name(), category: "OTHER", unit: "UNIT" });
        createdIds.push(item!.id);

        await expect(ItemService.update(item!.id, {})).rejects.toMatchObject({ status: 400 });
    });

    test("update name recomputes normalized_key", async () => {
        const item = await ItemService.create({ name: name(), category: "OTHER", unit: "UNIT" });
        createdIds.push(item!.id);

        const newName = `Renamed ${crypto.randomUUID()}`;
        const updated = await ItemService.update(item!.id, { name: newName });
        expect(updated!.normalized_key).toBe(newName.toLowerCase());
    });

    test("setActive toggles is_active", async () => {
        const item = await ItemService.create({ name: name(), category: "OTHER", unit: "UNIT" });
        createdIds.push(item!.id);

        const deactivated = await ItemService.setActive(item!.id, false);
        expect(deactivated.is_active).toBe(false);
    });

    test("listing filters by category", async () => {
        const item = await ItemService.create({ name: name(), category: "VACCINE", unit: "VIAL" });
        createdIds.push(item!.id);

        const { items } = await ItemService.getAll({ page: 1, limit: 100, category: "VACCINE" });
        expect(items.some((i) => i.id === item!.id)).toBe(true);
        expect(items.every((i) => i.category === "VACCINE")).toBe(true);
    });
});
