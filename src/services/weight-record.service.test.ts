import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { WeightRecordService } from "./weight-record.service";

let batchId: string;
let houseId: string;
let profileId: string;
const createdIds: string[] = [];

describe("WeightRecordService", () => {
    beforeAll(async () => {
        const house = await prisma.houses.create({
            data: { name: "Weight House", type: "GROWER", number: 701 },
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
        await prisma.weightRecords.deleteMany({ where: { id: { in: createdIds } } });
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
});
