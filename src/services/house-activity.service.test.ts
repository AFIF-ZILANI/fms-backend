import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { BatchService } from "./batch.service";
import { MortalityLogService } from "./mortality-log.service";
import { houseActivity } from "./house-activity.service";
import { houseNumber, purgeAuditLog } from "@lib/test-fixtures";

let houseId: string;
let profileId: string;
let batchId: string;

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

describe("houseActivity", () => {
    beforeAll(async () => {
        const [house, profile] = await Promise.all([
            prisma.houses.create({
                data: { name: "Activity House", type: "BROODER", number: houseNumber() },
            }),
            prisma.profiles.create({
                data: {
                    name: "Activity Recorder",
                    mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                    role: "ADMIN",
                },
            }),
        ]);
        houseId = house.id;
        profileId = profile.id;
        const batch = await BatchService.create({
            batch_code: `BATCH-${crypto.randomUUID()}`,
            breed: "CLASSIC",
            expected_selling_date: new Date(Date.now() + 30 * 86400_000),
            initial_chick_count: 500,
            init_chicks_avg_wt: 40,
            house_id: houseId,
            recorded_by_id: profileId,
        });
        batchId = batch!.id;
        // Placement is "now"; two deaths earlier and a reading in between.
        await prisma.batchHouseAllocation.updateMany({
            where: { batch_id: batchId },
            data: { occurred_at: hoursAgo(10) },
        });
        for (const [count, h] of [
            [3, 2],
            [1, 6],
        ] as const) {
            await MortalityLogService.create({
                batch_id: batchId,
                house_id: houseId,
                count_died: count,
                cause_note: count === 3 ? "Heat" : undefined,
                date: hoursAgo(h),
                recorded_by_id: profileId,
            });
        }
        await prisma.environmentRecords.create({
            data: {
                batch_id: batchId,
                house_id: houseId,
                temperature_c: 29.5,
                humidity_percent: 61,
                ammonia_ppm: 12,
                co2_ppm: 900,
                air_pressure_hpa: 1010,
                time_period: "MORNING",
                recorded_by_id: profileId,
                recorded_at: hoursAgo(4),
                idempotency_key: crypto.randomUUID(),
            },
        });
        // Taken three days ago, entered now: no honest time of day to show.
        const day = new Date(Date.now() - 3 * 86400_000);
        await prisma.weightRecords.create({
            data: {
                batch_id: batchId,
                house_id: houseId,
                average_wt_grams: 250,
                sample_size: 20,
                date: new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())),
                measured_by_id: profileId,
                idempotency_key: crypto.randomUUID(),
            },
        });
    });

    afterAll(async () => {
        await prisma.weightRecords.deleteMany({ where: { house_id: houseId } });
        await prisma.environmentRecords.deleteMany({ where: { house_id: houseId } });
        await prisma.mortalityLog.deleteMany({ where: { batch_id: batchId } });
        await prisma.batchHouseBalance.deleteMany({ where: { batch_id: batchId } });
        await prisma.batchHouseAllocation.deleteMany({ where: { batch_id: batchId } });
        await prisma.batches.delete({ where: { id: batchId } });
        await prisma.houses.delete({ where: { id: houseId } });
        await purgeAuditLog({ where: { changed_by_id: profileId } });
        await prisma.profiles.delete({ where: { id: profileId } });
    });

    test("newest first across every kind, worded, with who did it", async () => {
        const { activity, meta } = await houseActivity(houseId, { page: 1, limit: 20 });
        expect(meta.total).toBe(5);
        expect(activity.map((a) => a.kind)).toEqual([
            "MORTALITY",
            "ENVIRONMENT",
            "MORTALITY",
            "BIRDS_IN",
            "WEIGHT",
        ]);
        expect(activity[0]).toMatchObject({
            title: "3 birds died",
            detail: "Heat",
            by: "Activity Recorder",
        });
        expect(activity[1]).toMatchObject({
            title: "29.5°C · 61% humidity",
            detail: "Ammonia 12 ppm · CO₂ 900 ppm",
        });
        expect(activity[3]!.title).toBe("500 birds placed");
        expect(activity[4]).toMatchObject({ title: "Weighed 250 g average", day_only: true });
    });

    test("pages slice the same merged order without gaps or repeats", async () => {
        const all = (await houseActivity(houseId, { page: 1, limit: 20 })).activity.map(
            (a) => a.id,
        );
        const pages = await Promise.all(
            [1, 2, 3].map((page) => houseActivity(houseId, { page, limit: 2 })),
        );
        expect(pages.flatMap((p) => p.activity.map((a) => a.id))).toEqual(all);
        expect(pages[2]!.meta.totalPages).toBe(3);
    });
});
