import { describe, test, expect, afterAll } from "bun:test";
import prisma from "@lib/db";
import { HouseService } from "./house.service";
import { BatchService } from "./batch.service";
import { AppError } from "@lib/app-error";

const createdIds: string[] = [];
const createdBatchIds: string[] = [];
const createdProfileIds: string[] = [];

describe("HouseService", () => {
    afterAll(async () => {
        await prisma.batchHouseBalance.deleteMany({ where: { batch_id: { in: createdBatchIds } } });
        await prisma.batchHouseAllocation.deleteMany({ where: { batch_id: { in: createdBatchIds } } });
        await prisma.batches.deleteMany({ where: { id: { in: createdBatchIds } } });
        await prisma.houses.deleteMany({ where: { id: { in: createdIds } } });
        await prisma.profiles.deleteMany({ where: { id: { in: createdProfileIds } } });
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

    test("listing filters by is_available", async () => {
        const empty = await HouseService.create({ name: "Shed G", type: "BROODER", number: 7 });
        const occupied = await HouseService.create({ name: "Shed H", type: "BROODER", number: 8 });
        createdIds.push(empty.id, occupied.id);

        const profile = await prisma.profiles.create({
            data: { name: "House Test Recorder", mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`, role: "ADMIN" },
        });
        createdProfileIds.push(profile.id);
        const batch = await BatchService.create({
            batch_code: `HOUSE-AVAIL-${crypto.randomUUID()}`,
            breed: "CLASSIC",
            expected_selling_date: new Date(Date.now() + 30 * 86400_000),
            initial_chick_count: 100,
            init_chicks_avg_wt: 40,
            house_id: occupied.id,
            recorded_by_id: profile.id,
        });
        createdBatchIds.push(batch!.id);

        const available = await HouseService.getAll({ page: 1, limit: 100, is_available: "true" });
        expect(available.houses.some((h) => h.id === empty.id)).toBe(true);
        expect(available.houses.some((h) => h.id === occupied.id)).toBe(false);

        const unavailable = await HouseService.getAll({ page: 1, limit: 100, is_available: "false" });
        expect(unavailable.houses.some((h) => h.id === occupied.id)).toBe(true);
        expect(unavailable.houses.some((h) => h.id === empty.id)).toBe(false);
    });

    test("remove deletes an untouched house but refuses one with history", async () => {
        const clean = await HouseService.create({ name: "Shed Del", type: "GROWER", number: 90 });
        await HouseService.remove(clean.id);
        await expect(HouseService.getById(clean.id)).rejects.toMatchObject({ status: 404 });

        // Attached via a real relation (FK would allow the delete on some of these).
        const profile = await prisma.profiles.create({
            data: { name: "House Delete Recorder", mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`, role: "ADMIN" },
        });
        createdProfileIds.push(profile.id);
        const weighed = await HouseService.create({ name: "Shed Weighed", type: "GROWER", number: 91 });
        createdIds.push(weighed.id);
        await prisma.weightRecords.create({
            data: {
                house_id: weighed.id, average_wt_grams: 800, sample_size: 10,
                date: new Date(), measured_by_id: profile.id, idempotency_key: crypto.randomUUID(),
            },
        });
        await expect(HouseService.remove(weighed.id)).rejects.toMatchObject({ status: 409 });
        await prisma.weightRecords.deleteMany({ where: { house_id: weighed.id } });

        // Attached only through the polymorphic stock ledger -- no FK at all.
        const stocked = await HouseService.create({ name: "Shed Stocked", type: "GROWER", number: 92 });
        createdIds.push(stocked.id);
        const item = await prisma.item.create({
            data: {
                name: `House Delete Item ${crypto.randomUUID()}`,
                normalized_key: `house delete item ${crypto.randomUUID()}`,
                category: "FEED",
                unit: "G",
            },
        });
        await prisma.stockLedger.create({
            data: {
                item_id: item.id, quantity: 5, direction: "IN", reason: "TRANSFER",
                ref_type: "TRANSFER", ref_id: crypto.randomUUID(), idempotency_key: crypto.randomUUID(),
                location_type: "HOUSE", location_id: stocked.id,
            },
        });
        await expect(HouseService.remove(stocked.id)).rejects.toMatchObject({ status: 409 });
        await prisma.stockLedger.deleteMany({ where: { item_id: item.id } });
        await prisma.item.delete({ where: { id: item.id } });
    });

    test("getStock returns nonzero item balances at this house only", async () => {
        const house = await HouseService.create({
            name: "Stock Test House",
            type: "GROWER",
            number: Math.floor(Math.random() * 100000),
        });
        createdIds.push(house.id);
        const item = await prisma.item.create({
            data: {
                name: `House Stock Item ${crypto.randomUUID()}`,
                normalized_key: `house stock item ${crypto.randomUUID()}`,
                category: "FEED",
                unit: "G",
            },
        });
        await prisma.stockLedger.create({
            data: {
                item_id: item.id, quantity: 60, direction: "IN", reason: "TRANSFER",
                ref_type: "TRANSFER", ref_id: crypto.randomUUID(), idempotency_key: crypto.randomUUID(),
                location_type: "HOUSE", location_id: house.id,
            },
        });

        const stock = await HouseService.getStock(house.id);
        expect(stock).toHaveLength(1);
        expect(stock[0]!.item_id).toBe(item.id);
        expect(stock[0]!.balance.toNumber()).toBe(60);

        await prisma.stockLedger.deleteMany({ where: { item_id: item.id } });
        await prisma.item.delete({ where: { id: item.id } });
    });
});
