import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { WeightRecordService } from "./weight-record.service";
import { houseNumber } from "@lib/test-fixtures";

let batchId: string;
let houseId: string;
let profileId: string;
const createdIds: string[] = [];

describe("WeightRecordService", () => {
    beforeAll(async () => {
        const house = await prisma.houses.create({
            data: { name: "Weight House", type: "GROWER", number: houseNumber() },
        });
        houseId = house.id;
        const profile = await prisma.profiles.create({
            data: {
                name: "Weight Recorder",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "ADMIN",
            },
        });
        profileId = profile.id;
        const batch = await prisma.batches.create({
            data: {
                batch_code: `WT-${crypto.randomUUID()}`,
                breed: "KEDERNATH",
                expected_selling_date: new Date(Date.now() + 30 * 86400_000),
                initial_chick_count: 500,
                init_chicks_avg_wt: 40,
            },
        });
        batchId = batch.id;
    });

    afterAll(async () => {
        // Whatever the tests wrote for this house, tracked or not (a failed test must not leave rows).
        await prisma.weightRecords.deleteMany({ where: { house_id: houseId } });
        await prisma.batches.delete({ where: { id: batchId } });
        await prisma.houses.delete({ where: { id: houseId } });
        await prisma.profiles.delete({ where: { id: profileId } });
    });

    test("create then list", async () => {
        const date = new Date();
        const record = await WeightRecordService.create({
            batch_id: batchId,
            house_id: houseId,
            average_wt_grams: 450.5,
            sample_size: 20,
            date,
            measured_by_id: profileId,
        });
        createdIds.push(record!.id);

        const { records } = await WeightRecordService.getAll({
            page: 1,
            limit: 100,
            batch_id: batchId,
        });
        expect(records.some((r) => r.id === record!.id)).toBe(true);
    });

    test("duplicate batch+house+date throws a conflict", async () => {
        const date = new Date("2026-08-06T00:00:00Z");
        const first = await WeightRecordService.create({
            batch_id: batchId,
            house_id: houseId,
            average_wt_grams: 400,
            sample_size: 10,
            date,
            measured_by_id: profileId,
        });
        createdIds.push(first!.id);

        await expect(
            WeightRecordService.create({
                batch_id: batchId,
                house_id: houseId,
                average_wt_grams: 410,
                sample_size: 10,
                date,
                measured_by_id: profileId,
            }),
        ).rejects.toMatchObject({ status: 409 });
    });

    const weigh = (date: string, over: { batch_id?: string | null } = {}) =>
        WeightRecordService.create({
            ...((over.batch_id === undefined ? batchId : over.batch_id) !== null && {
                batch_id: over.batch_id === undefined ? batchId : (over.batch_id as string),
            }),
            house_id: houseId,
            average_wt_grams: 500,
            sample_size: 10,
            date: new Date(date),
            measured_by_id: profileId,
        });

    test("the stored date is the farm-local day, not the UTC date", async () => {
        // 23:00 UTC on 3 Mar is 05:00 on 4 Mar in Dhaka.
        const r = await weigh("2027-03-03T23:00:00Z");
        createdIds.push(r!.id);
        expect(r!.date.toISOString()).toBe("2027-03-04T00:00:00.000Z");
    });

    test("two samples on the same farm day collide even when their timestamps differ", async () => {
        const first = await weigh("2027-04-10T02:00:00Z"); // 08:00 Dhaka
        createdIds.push(first!.id);
        // Previously these were different keys (different timestamps) and both were stored.
        await expect(weigh("2027-04-10T09:30:00Z")).rejects.toMatchObject({ status: 409 });
        // 05:00 Dhaka the same day is the *previous* UTC date but the same farm day.
        await expect(weigh("2027-04-09T23:30:00Z")).rejects.toMatchObject({ status: 409 });
        // The next farm day is free.
        const next = await weigh("2027-04-11T02:00:00Z");
        createdIds.push(next!.id);
    });

    test("weighing an empty house (no batch) twice in one day is also a conflict", async () => {
        const first = await weigh("2027-05-02T03:00:00Z", { batch_id: null });
        createdIds.push(first!.id);
        // NULL batch_id used to slip past the composite unique, so this was silently stored twice.
        await expect(weigh("2027-05-02T10:00:00Z", { batch_id: null })).rejects.toMatchObject({ status: 409 });
        // A batch weighing the same day in the same house is a different thing and is allowed.
        const withBatch = await weigh("2027-05-02T04:00:00Z");
        createdIds.push(withBatch!.id);
    });
});
