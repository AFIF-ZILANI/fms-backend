import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { BatchService } from "./batch.service";
import { AppError } from "@lib/app-error";

const createdBatchIds: string[] = [];
let houseId: string;
let profileId: string;

const batchCode = () => `BATCH-${crypto.randomUUID()}`;

describe("BatchService", () => {
    beforeAll(async () => {
        const house = await prisma.houses.create({
            data: { name: "Batch Test House", type: "BROODER", number: 101 },
        });
        houseId = house.id;
        const profile = await prisma.profiles.create({
            data: {
                name: "Seed Recorder",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "ADMIN",
            },
        });
        profileId = profile.id;
    });

    afterAll(async () => {
        await prisma.batchHouseBalance.deleteMany({ where: { batch_id: { in: createdBatchIds } } });
        await prisma.batchHouseAllocation.deleteMany({
            where: { batch_id: { in: createdBatchIds } },
        });
        await prisma.batches.deleteMany({ where: { id: { in: createdBatchIds } } });
        await prisma.houses.delete({ where: { id: houseId } });
        await prisma.profiles.delete({ where: { id: profileId } });
    });

    test("create makes the batch, an INITIAL allocation, and a matching balance", async () => {
        const batch = await BatchService.create({
            batch_code: batchCode(),
            breed: "CLASSIC",
            expected_selling_date: new Date(Date.now() + 30 * 86400_000),
            initial_chick_count: 1000,
            init_chicks_avg_wt: 40,
            house_id: houseId,
            recorded_by_id: profileId,
        });
        createdBatchIds.push(batch!.id);

        expect(batch!.status).toBe("RUNNING");
        expect(batch!.houseBalances.length).toBe(1);
        expect(batch!.houseBalances[0]!.quantity).toBe(1000);
        expect(batch!.houseBalances[0]!.house_id).toBe(houseId);

        const allocation = await prisma.batchHouseAllocation.findFirst({
            where: { batch_id: batch!.id },
        });
        expect(allocation?.reason).toBe("INITIAL");
        expect(allocation?.to_house_id).toBe(houseId);
        expect(allocation?.quantity).toBe(1000);
    });

    test("duplicate batch_code throws a conflict", async () => {
        const code = batchCode();
        const first = await BatchService.create({
            batch_code: code,
            breed: "TIGER",
            expected_selling_date: new Date(Date.now() + 30 * 86400_000),
            initial_chick_count: 500,
            init_chicks_avg_wt: 38,
            house_id: houseId,
            recorded_by_id: profileId,
        });
        createdBatchIds.push(first!.id);

        await expect(
            BatchService.create({
                batch_code: code,
                breed: "TIGER",
                expected_selling_date: new Date(Date.now() + 30 * 86400_000),
                initial_chick_count: 500,
                init_chicks_avg_wt: 38,
                house_id: houseId,
                recorded_by_id: profileId,
            }),
        ).rejects.toMatchObject({ status: 409 });
    });

    test("create with a nonexistent house_id throws bad-request, not a raw 500", async () => {
        await expect(
            BatchService.create({
                batch_code: batchCode(),
                breed: "FAOMI",
                expected_selling_date: new Date(Date.now() + 30 * 86400_000),
                initial_chick_count: 500,
                init_chicks_avg_wt: 38,
                house_id: "00000000-0000-0000-0000-000000000000",
                recorded_by_id: profileId,
            }),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("getById on unknown id throws not-found", async () => {
        await expect(
            BatchService.getById("00000000-0000-0000-0000-000000000000"),
        ).rejects.toBeInstanceOf(AppError);
    });

    test("close without force throws when birds remain allocated", async () => {
        const batch = await BatchService.create({
            batch_code: batchCode(),
            breed: "HIBREED",
            expected_selling_date: new Date(Date.now() + 30 * 86400_000),
            initial_chick_count: 200,
            init_chicks_avg_wt: 40,
            house_id: houseId,
            recorded_by_id: profileId,
        });
        createdBatchIds.push(batch!.id);

        await expect(BatchService.close(batch!.id, { status: "CLOSED" })).rejects.toMatchObject({
            status: 409,
        });
    });

    test("close with force succeeds regardless of remaining balance", async () => {
        const batch = await BatchService.create({
            batch_code: batchCode(),
            breed: "KEDERNATH",
            expected_selling_date: new Date(Date.now() + 30 * 86400_000),
            initial_chick_count: 300,
            init_chicks_avg_wt: 40,
            house_id: houseId,
            recorded_by_id: profileId,
        });
        createdBatchIds.push(batch!.id);

        const closed = await BatchService.close(batch!.id, { status: "CLOSED", force: true });
        expect(closed.status).toBe("CLOSED");
        expect(closed.actual_end_date).not.toBeNull();
    });

    test("cannot edit a batch that isn't RUNNING", async () => {
        const batch = await BatchService.create({
            batch_code: batchCode(),
            breed: "PAKISTHANI",
            expected_selling_date: new Date(Date.now() + 30 * 86400_000),
            initial_chick_count: 100,
            init_chicks_avg_wt: 40,
            house_id: houseId,
            recorded_by_id: profileId,
        });
        createdBatchIds.push(batch!.id);
        await BatchService.close(batch!.id, { status: "CLOSED", force: true });

        await expect(BatchService.update(batch!.id, { breed: "TIGER" })).rejects.toMatchObject({
            status: 409,
        });
    });
});
