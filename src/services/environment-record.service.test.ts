import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { EnvironmentRecordService } from "./environment-record.service";

let batchId: string;
let houseId: string;
let profileId: string;
const createdIds: string[] = [];

describe("EnvironmentRecordService", () => {
    beforeAll(async () => {
        const house = await prisma.houses.create({
            data: { name: "Env House", type: "BROODER", number: 601 },
        });
        houseId = house.id;
        const profile = await prisma.profiles.create({
            data: {
                name: "Env Recorder",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "ADMIN",
            },
        });
        profileId = profile.id;
        const batch = await prisma.batches.create({
            data: {
                batch_code: `ENV-${crypto.randomUUID()}`,
                breed: "FAOMI",
                expected_selling_date: new Date(Date.now() + 30 * 86400_000),
                initial_chick_count: 500,
                init_chicks_avg_wt: 40,
            },
        });
        batchId = batch.id;
    });

    afterAll(async () => {
        await prisma.environmentRecords.deleteMany({ where: { id: { in: createdIds } } });
        await prisma.batches.delete({ where: { id: batchId } });
        await prisma.houses.delete({ where: { id: houseId } });
        await prisma.profiles.delete({ where: { id: profileId } });
    });

    test("create then list, filtered by house_id", async () => {
        const record = await EnvironmentRecordService.create({
            batch_id: batchId,
            house_id: houseId,
            temperature_c: 32.5,
            humidity_percent: 60,
            ammonia_ppm: 5,
            co2_ppm: 800,
            air_pressure_hpa: 1013,
            time_period: "MORNING",
            recorded_by_id: profileId,
        });
        createdIds.push(record!.id);

        const { records } = await EnvironmentRecordService.getAll({
            page: 1,
            limit: 100,
            house_id: houseId,
        });
        expect(records.some((r) => r.id === record!.id)).toBe(true);
        expect(records[0]!.temperature_c).toBe(32.5);
    });
});
