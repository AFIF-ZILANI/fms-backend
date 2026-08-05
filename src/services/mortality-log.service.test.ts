import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { BatchService } from "./batch.service";
import { MortalityLogService } from "./mortality-log.service";

const createdBatchIds: string[] = [];
let houseId: string;
let profileId: string;

const batchCode = () => `BATCH-${crypto.randomUUID()}`;

async function newRunningBatch(count: number) {
    const batch = await BatchService.create({
        batch_code: batchCode(),
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

describe("MortalityLogService", () => {
    beforeAll(async () => {
        const [house, profile] = await Promise.all([
            prisma.houses.create({
                data: { name: "Mortality House", type: "BROODER", number: 301 },
            }),
            prisma.profiles.create({
                data: {
                    name: "Mortality Recorder",
                    mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                    role: "ADMIN",
                },
            }),
        ]);
        houseId = house.id;
        profileId = profile.id;
    });

    afterAll(async () => {
        await prisma.mortalityLog.deleteMany({ where: { batch_id: { in: createdBatchIds } } });
        await prisma.batchHouseBalance.deleteMany({ where: { batch_id: { in: createdBatchIds } } });
        await prisma.batchHouseAllocation.deleteMany({
            where: { batch_id: { in: createdBatchIds } },
        });
        await prisma.batches.deleteMany({ where: { id: { in: createdBatchIds } } });
        await prisma.houses.delete({ where: { id: houseId } });
        await prisma.profiles.delete({ where: { id: profileId } });
    });

    test("logging mortality decrements the batch-house balance", async () => {
        const batch = await newRunningBatch(1000);

        const log = await MortalityLogService.create({
            batch_id: batch.id,
            house_id: houseId,
            count_died: 15,
            date: new Date(),
            recorded_by_id: profileId,
        });
        expect(log.count_died).toBe(15);

        const balance = await prisma.batchHouseBalance.findUnique({
            where: { batch_id_house_id: { batch_id: batch.id, house_id: houseId } },
        });
        expect(balance?.quantity).toBe(985);
    });

    test("mortality exceeding live balance throws a conflict and doesn't write a log row", async () => {
        const batch = await newRunningBatch(10);

        await expect(
            MortalityLogService.create({
                batch_id: batch.id,
                house_id: houseId,
                count_died: 50,
                date: new Date(),
                recorded_by_id: profileId,
            }),
        ).rejects.toMatchObject({ status: 409 });

        const logCount = await prisma.mortalityLog.count({ where: { batch_id: batch.id } });
        expect(logCount).toBe(0);
        const balance = await prisma.batchHouseBalance.findUnique({
            where: { batch_id_house_id: { batch_id: batch.id, house_id: houseId } },
        });
        expect(balance?.quantity).toBe(10);
    });

    test("cumulative mortality logs keep decrementing correctly", async () => {
        const batch = await newRunningBatch(100);

        await MortalityLogService.create({
            batch_id: batch.id,
            house_id: houseId,
            count_died: 5,
            date: new Date(),
            recorded_by_id: profileId,
        });
        await MortalityLogService.create({
            batch_id: batch.id,
            house_id: houseId,
            count_died: 3,
            date: new Date(),
            recorded_by_id: profileId,
        });

        const balance = await prisma.batchHouseBalance.findUnique({
            where: { batch_id_house_id: { batch_id: batch.id, house_id: houseId } },
        });
        expect(balance?.quantity).toBe(92);
    });
});
