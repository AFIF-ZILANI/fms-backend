import { describe, test, expect, afterAll } from "bun:test";
import prisma from "./db";
import { createLookupService } from "./lookup-factory";
import { AppError } from "./app-error";

const service = createLookupService(prisma.itemCategory, "ItemCategory");
const createdIds: string[] = [];

describe("createLookupService (against ItemCategory)", () => {
    afterAll(async () => {
        await prisma.itemCategory.deleteMany({ where: { id: { in: createdIds } } });
    });

    test("create derives code from label", async () => {
        const row = await service.create("Cleaning Supplies Test");
        createdIds.push(row.id);
        expect(row.code).toBe("CLEANING_SUPPLIES_TEST");
        expect(row.label).toBe("Cleaning Supplies Test");
        expect(row.is_active).toBe(true);
    });

    test("create rejects a label with no letters or digits", async () => {
        await expect(service.create("!!!")).rejects.toBeInstanceOf(AppError);
    });

    test("create rejects a duplicate resulting code", async () => {
        const row = await service.create("Duplicate Code Test");
        createdIds.push(row.id);
        await expect(service.create("duplicate code test")).rejects.toBeInstanceOf(AppError);
    });

    test("update recomputes code from the new label", async () => {
        const row = await service.create("Rename Me Test");
        createdIds.push(row.id);
        const updated = await service.update(row.id, "Renamed Test");
        expect(updated.code).toBe("RENAMED_TEST");
    });

    test("setActive toggles is_active", async () => {
        const row = await service.create("Toggle Me Test");
        createdIds.push(row.id);
        const deactivated = await service.setActive(row.id, false);
        expect(deactivated.is_active).toBe(false);
        const reactivated = await service.setActive(row.id, true);
        expect(reactivated.is_active).toBe(true);
    });

    test("getAll with active=true excludes deactivated rows", async () => {
        const row = await service.create("Filtered Out Test");
        createdIds.push(row.id);
        await service.setActive(row.id, false);
        const { rows } = await service.getAll({ active: "true", page: 1, limit: 100 });
        expect(rows.find((r) => r.id === row.id)).toBeUndefined();
    });

    test("renaming a lookup row cascades its new code onto a referencing Item.category via onUpdate: Cascade", async () => {
        const category = await service.create("Cascade Rename Test");
        createdIds.push(category.id);

        const item = await prisma.item.create({
            data: {
                name: `Cascade Test Item ${crypto.randomUUID()}`,
                normalized_key: `cascade test item ${crypto.randomUUID()}`,
                category: category.code,
                unit: "BAG",
            },
        });

        try {
            const renamed = await service.update(category.id, "Cascade Renamed Test");
            expect(renamed.code).not.toBe(category.code);

            const refetched = await prisma.item.findUnique({ where: { id: item.id } });
            expect(refetched?.category).toBe(renamed.code);
            expect(refetched?.category).not.toBe(category.code);
        } finally {
            await prisma.item.delete({ where: { id: item.id } });
        }
    });
});
