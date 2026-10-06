import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { BatchService } from "@services/batch.service";
import { BatchHouseAllocationService } from "@services/batch-house-allocation.service";
import { BirdSaleService } from "@services/bird-sale.service";

const createdBatchIds: string[] = [];
const createdHouseIds: string[] = [];
let profileId: string;

async function newHouse(name: string, number: number) {
    const house = await prisma.houses.create({ data: { name, type: "BROODER", number } });
    createdHouseIds.push(house.id);
    return house;
}

async function newBatchIn(houseId: string, count: number) {
    const batch = await BatchService.create({
        batch_code: `TURNAROUND-${crypto.randomUUID()}`,
        breed: "CLASSIC",
        expected_selling_date: new Date(Date.now() + 30 * 86400_000),
        initial_chick_count: count,
        init_chicks_avg_wt: 40,
        house_id: houseId,
        recorded_by_id: profileId,
    });
    createdBatchIds.push(batch!.id);
    return batch!;
}

const phaseOf = async (id: string) =>
    (await prisma.houses.findUniqueOrThrow({ where: { id } })).phase;

describe("markEmptiedHousesCleaning", () => {
    beforeAll(async () => {
        const profile = await prisma.profiles.create({
            data: {
                name: "Turnaround Recorder",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "ADMIN",
            },
        });
        profileId = profile.id;
    });

    afterAll(async () => {
        await prisma.birdSale.deleteMany({ where: { batch_id: { in: createdBatchIds } } });
        await prisma.batchHouseBalance.deleteMany({ where: { batch_id: { in: createdBatchIds } } });
        await prisma.batchHouseAllocation.deleteMany({ where: { batch_id: { in: createdBatchIds } } });
        await prisma.batches.deleteMany({ where: { id: { in: createdBatchIds } } });
        await prisma.houses.deleteMany({ where: { id: { in: createdHouseIds } } });
        await prisma.profiles.deleteMany({ where: { id: profileId } });
    });

    test("transferring the last bird out puts the source house into CLEANING", async () => {
        const from = await newHouse("Turnaround From", 301);
        const to = await newHouse("Turnaround To", 302);
        const batch = await newBatchIn(from.id, 100);

        await BatchHouseAllocationService.create({
            batch_id: batch.id,
            from_house_id: from.id,
            to_house_id: to.id,
            quantity: 60,
            reason: "TRANSFER",
            recorded_by_id: profileId,
        });
        expect(await phaseOf(from.id)).toBe("READY");

        await BatchHouseAllocationService.create({
            batch_id: batch.id,
            from_house_id: from.id,
            to_house_id: to.id,
            quantity: 40,
            reason: "TRANSFER",
            recorded_by_id: profileId,
        });
        expect(await phaseOf(from.id)).toBe("CLEANING");
        // The house that received them is occupied, so it stays put.
        expect(await phaseOf(to.id)).toBe("READY");
    });

    test("selling the last bird puts the house into CLEANING", async () => {
        const house = await newHouse("Turnaround Sale", 303);
        const batch = await newBatchIn(house.id, 50);

        await BirdSaleService.create({
            batch_id: batch.id,
            house_id: house.id,
            sale_date: new Date(),
            grade: "HIGH",
            birds_count: 50,
            dholta_in_g: 0,
            total_katha: 0,
            total_weight: 100,
            net_weight: 100,
            price_per_kg: 150,
            paid_amount: 0,
            recorded_by_id: profileId,
        });

        expect(await phaseOf(house.id)).toBe("CLEANING");
    });

    test("a phase the operator already set is never overwritten", async () => {
        const house = await newHouse("Turnaround Maintained", 304);
        const batch = await newBatchIn(house.id, 20);
        await prisma.houses.update({ where: { id: house.id }, data: { phase: "MAINTENANCE" } });

        await BatchHouseAllocationService.create({
            batch_id: batch.id,
            from_house_id: house.id,
            quantity: 20,
            reason: "ADJUSTMENT",
            recorded_by_id: profileId,
        });

        expect(await phaseOf(house.id)).toBe("MAINTENANCE");
    });

    test("force-closing a batch cleans the houses it leaves behind", async () => {
        const house = await newHouse("Turnaround Closed", 305);
        const batch = await newBatchIn(house.id, 80);

        await BatchService.close(batch.id, { status: "SOLD", force: true, recorded_by_id: profileId });

        expect(await phaseOf(house.id)).toBe("CLEANING");
    });
});
