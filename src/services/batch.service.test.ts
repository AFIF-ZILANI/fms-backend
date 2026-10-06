import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { BatchService } from "./batch.service";
import { AppError } from "@lib/app-error";
import { houseNumber } from "@lib/test-fixtures";

const createdBatchIds: string[] = [];
let houseId: string;
let profileId: string;

const batchCode = () => `BATCH-${crypto.randomUUID()}`;

describe("BatchService", () => {
    beforeAll(async () => {
        const house = await prisma.houses.create({
            data: { name: "Batch Test House", type: "BROODER", number: houseNumber() },
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

        await expect(BatchService.close(batch!.id, { status: "CLOSED", recorded_by_id: profileId })).rejects.toMatchObject({
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

        const closed = await BatchService.close(batch!.id, { status: "CLOSED", force: true, recorded_by_id: profileId });
        expect(closed.status).toBe("CLOSED");
        expect(closed.actual_end_date).not.toBeNull();

        // Force-closing with birds still on the books must zero the house balance too --
        // a CLOSED batch has none live, so the house should read as available again.
        const balance = await prisma.batchHouseBalance.findUnique({
            where: { batch_id_house_id: { batch_id: batch!.id, house_id: houseId } },
        });
        expect(balance!.quantity).toBe(0);

        // ...and not out of band: an ADJUSTMENT allocation takes the birds off the books, so
        // placed (+300) and removed (-300) still reconcile to the zero balance.
        const adjustments = await prisma.batchHouseAllocation.findMany({
            where: { batch_id: batch!.id, reason: "ADJUSTMENT" },
        });
        expect(adjustments).toHaveLength(1);
        expect(adjustments[0]).toMatchObject({
            from_house_id: houseId,
            to_house_id: null,
            quantity: 300,
            recorded_by_id: profileId,
        });
    });

    test("a refused close leaves the batch RUNNING", async () => {
        const batch = await BatchService.create({
            batch_code: batchCode(),
            breed: "CLASSIC",
            expected_selling_date: new Date(Date.now() + 30 * 86400_000),
            initial_chick_count: 50,
            init_chicks_avg_wt: 40,
            house_id: houseId,
            recorded_by_id: profileId,
        });
        createdBatchIds.push(batch!.id);

        // Birds remain and there is no force: refused -- and the claim that flips the status
        // happens first inside the transaction, so it must roll back with the refusal.
        await expect(
            BatchService.close(batch!.id, { status: "CLOSED", recorded_by_id: profileId }),
        ).rejects.toMatchObject({ status: 409 });
        const after = await prisma.batches.findUniqueOrThrow({ where: { id: batch!.id } });
        expect(after.status).toBe("RUNNING");
        expect(after.actual_end_date).toBeNull();
    });

    test("closing an unknown batch is a 404", async () => {
        await expect(
            BatchService.close("00000000-0000-0000-0000-000000000000", {
                status: "CLOSED",
                recorded_by_id: profileId,
            }),
        ).rejects.toMatchObject({ status: 404 });
    });

    test("two simultaneous closes: one wins, the other is told it's no longer RUNNING", async () => {
        const batch = await BatchService.create({
            batch_code: batchCode(),
            breed: "HIBREED",
            expected_selling_date: new Date(Date.now() + 30 * 86400_000),
            initial_chick_count: 40,
            init_chicks_avg_wt: 40,
            house_id: houseId,
            recorded_by_id: profileId,
        });
        createdBatchIds.push(batch!.id);
        const close = () =>
            BatchService.close(batch!.id, { status: "CLOSED", force: true, recorded_by_id: profileId });

        const results = await Promise.allSettled([close(), close()]);
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
        expect(loser.reason).toMatchObject({ status: 409 });
        // One force-close, one adjustment -- not two.
        expect(
            await prisma.batchHouseAllocation.count({
                where: { batch_id: batch!.id, reason: "ADJUSTMENT" },
            }),
        ).toBe(1);
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
        await BatchService.close(batch!.id, { status: "CLOSED", force: true, recorded_by_id: profileId });

        await expect(BatchService.update(batch!.id, { breed: "TIGER" })).rejects.toMatchObject({
            status: 409,
        });
    });
});
