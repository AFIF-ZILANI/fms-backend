import { describe, test, expect, afterAll } from "bun:test";
import prisma from "@lib/db";
import { HouseService } from "./house.service";
import { AppError } from "@lib/app-error";

const createdIds: string[] = [];

describe("HouseService", () => {
    afterAll(async () => {
        await prisma.houses.deleteMany({ where: { id: { in: createdIds } } });
    });

    test("create then getById round-trips", async () => {
        const house = await HouseService.create({
            name: "Shed A",
            type: "BROODER",
            number: 1,
            capacity: 5000,
        });
        createdIds.push(house.id);

        const found = await HouseService.getById(house.id);
        expect(found.name).toBe("Shed A");
        expect(found.type).toBe("BROODER");
        expect(found.capacity).toBe(5000);
        expect(found.is_active).toBe(true);
    });

    test("create without capacity leaves it null", async () => {
        const house = await HouseService.create({ name: "Shed B", type: "GROWER", number: 2 });
        createdIds.push(house.id);
        expect(house.capacity).toBeNull();
    });

    test("getById on unknown id throws not-found", async () => {
        await expect(
            HouseService.getById("00000000-0000-0000-0000-000000000000"),
        ).rejects.toBeInstanceOf(AppError);
    });

    test("update with no fields throws bad-request", async () => {
        const house = await HouseService.create({ name: "Shed C", type: "LAYER", number: 3 });
        createdIds.push(house.id);

        await expect(HouseService.update(house.id, {})).rejects.toMatchObject({ status: 400 });
    });

    test("update changes fields", async () => {
        const house = await HouseService.create({ name: "Shed D", type: "BROODER", number: 4 });
        createdIds.push(house.id);

        const updated = await HouseService.update(house.id, { capacity: 3000 });
        expect(updated.capacity).toBe(3000);
        expect(updated.name).toBe("Shed D");
    });

    test("setActive toggles is_active", async () => {
        const house = await HouseService.create({ name: "Shed E", type: "GROWER", number: 5 });
        createdIds.push(house.id);

        const deactivated = await HouseService.setActive(house.id, false);
        expect(deactivated.is_active).toBe(false);

        const reactivated = await HouseService.setActive(house.id, true);
        expect(reactivated.is_active).toBe(true);
    });

    test("listing filters by type", async () => {
        const house = await HouseService.create({ name: "Shed F", type: "LAYER", number: 6 });
        createdIds.push(house.id);

        const { houses } = await HouseService.getAll({ page: 1, limit: 100, type: "LAYER" });
        expect(houses.some((h) => h.id === house.id)).toBe(true);
        expect(houses.every((h) => h.type === "LAYER")).toBe(true);
    });
});
