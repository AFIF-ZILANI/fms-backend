import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { VaccinationService } from "./vaccination.service";

let batchId: string;
let profileId: string;
const createdIds: string[] = [];

describe("VaccinationService", () => {
    beforeAll(async () => {
        const profile = await prisma.profiles.create({
            data: {
                name: "Vax Recorder",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "ADMIN",
            },
        });
        profileId = profile.id;
        const batch = await prisma.batches.create({
            data: {
                batch_code: `VAX-${crypto.randomUUID()}`,
                breed: "TIGER",
                expected_selling_date: new Date(Date.now() + 30 * 86400_000),
                initial_chick_count: 500,
                init_chicks_avg_wt: 40,
            },
        });
        batchId = batch.id;
    });

    afterAll(async () => {
        await prisma.vaccinations.deleteMany({ where: { id: { in: createdIds } } });
        await prisma.batches.delete({ where: { id: batchId } });
        await prisma.profiles.delete({ where: { id: profileId } });
    });

    test("create then list by batch_id", async () => {
        const vax = await VaccinationService.create({
            batch_id: batchId,
            vaccine_name: "Newcastle Disease",
            dosage: 1,
            administered_by_id: profileId,
        });
        createdIds.push(vax!.id);

        const { vaccinations } = await VaccinationService.getAll({
            page: 1,
            limit: 100,
            batch_id: batchId,
        });
        expect(vaccinations.some((v) => v.id === vax!.id)).toBe(true);
    });
});
