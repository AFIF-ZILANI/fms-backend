import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { BatchService } from "./batch.service";
import { BatchHouseAllocationService } from "./batch-house-allocation.service";

const createdBatchIds: string[] = [];
let houseAId: string;
let houseBId: string;
let profileId: string;

const batchCode = () => `BATCH-${crypto.randomUUID()}`;

async function newRunningBatch(count: number) {
    const batch = await BatchService.create({
        batch_code: batchCode(),
        breed: "CLASSIC",
        expected_selling_date: new Date(Date.now() + 30 * 86400_000),
        initial_chick_count: count,
        init_chicks_avg_wt: 40,
        house_id: houseAId,
        recorded_by_id: profileId,
    });
    createdBatchIds.push(batch!.id);
    return batch!;
}

async function balance(batchId: string, houseId: string) {
    return prisma.batchHouseBalance.findUnique({
        where: { batch_id_house_id: { batch_id: batchId, house_id: houseId } },
    });
}

describe("BatchHouseAllocationService", () => {
    beforeAll(async () => {
        const [a, b, profile] = await Promise.all([
            prisma.houses.create({ data: { name: "Alloc House A", type: "BROODER", number: 201 } }),
            prisma.houses.create({ data: { name: "Alloc House B", type: "GROWER", number: 202 } }),
            prisma.profiles.create({
                data: {
                    name: "Alloc Recorder",
                    mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                    role: "ADMIN",
                },
            }),
        ]);
        houseAId = a.id;
        houseBId = b.id;
        profileId = profile.id;
    });

    afterAll(async () => {
        await prisma.batchHouseBalance.deleteMany({ where: { batch_id: { in: createdBatchIds } } });
        await prisma.batchHouseAllocation.deleteMany({
            where: { batch_id: { in: createdBatchIds } },
        });
        await prisma.batches.deleteMany({ where: { id: { in: createdBatchIds } } });
        await prisma.houses.deleteMany({ where: { id: { in: [houseAId, houseBId] } } });
        await prisma.profiles.delete({ where: { id: profileId } });
    });

    test("TRANSFER moves birds: decrements source, increments destination", async () => {
        const batch = await newRunningBatch(1000);

        await BatchHouseAllocationService.create({
            batch_id: batch.id,
            from_house_id: houseAId,
            to_house_id: houseBId,
            quantity: 400,
            reason: "TRANSFER",
            recorded_by_id: profileId,
        });

        const fromBalance = await balance(batch.id, houseAId);
        const toBalance = await balance(batch.id, houseBId);
        expect(fromBalance?.quantity).toBe(600);
        expect(toBalance?.quantity).toBe(400);
    });

    test("TRANSFER exceeding source balance throws a conflict and rolls back", async () => {
        const batch = await newRunningBatch(100);

        await expect(
            BatchHouseAllocationService.create({
                batch_id: batch.id,
                from_house_id: houseAId,
                to_house_id: houseBId,
                quantity: 500,
                reason: "TRANSFER",
                recorded_by_id: profileId,
            }),
        ).rejects.toMatchObject({ status: 409 });

        // rollback check -- source balance must be untouched, no allocation row committed
        const fromBalance = await balance(batch.id, houseAId);
        expect(fromBalance?.quantity).toBe(100);
        const allocationCount = await prisma.batchHouseAllocation.count({
            where: { batch_id: batch.id, reason: "TRANSFER" },
        });
        expect(allocationCount).toBe(0);
    });

    test("ADJUSTMENT with only to_house_id increments that house only", async () => {
        const batch = await newRunningBatch(200);

        await BatchHouseAllocationService.create({
            batch_id: batch.id,
            to_house_id: houseBId,
            quantity: 50,
            reason: "ADJUSTMENT",
            recorded_by_id: profileId,
        });

        const houseABalance = await balance(batch.id, houseAId);
        const houseBBalance = await balance(batch.id, houseBId);
        expect(houseABalance?.quantity).toBe(200);
        expect(houseBBalance?.quantity).toBe(50);
    });

    test("ADJUSTMENT with only from_house_id decrements that house only", async () => {
        const batch = await newRunningBatch(300);

        await BatchHouseAllocationService.create({
            batch_id: batch.id,
            from_house_id: houseAId,
            quantity: 30,
            reason: "ADJUSTMENT",
            recorded_by_id: profileId,
        });

        const houseABalance = await balance(batch.id, houseAId);
        expect(houseABalance?.quantity).toBe(270);
    });

    test("allocation on a non-RUNNING batch throws a conflict", async () => {
        const batch = await newRunningBatch(150);
        await BatchService.close(batch.id, { status: "CLOSED", force: true });

        await expect(
            BatchHouseAllocationService.create({
                batch_id: batch.id,
                from_house_id: houseAId,
                to_house_id: houseBId,
                quantity: 10,
                reason: "TRANSFER",
                recorded_by_id: profileId,
            }),
        ).rejects.toMatchObject({ status: 409 });
    });
});
