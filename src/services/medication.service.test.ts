import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { MedicationService } from "./medication.service";

let batchId: string;
let houseId: string;
let profileId: string;
const createdIds: string[] = [];

describe("MedicationService", () => {
    beforeAll(async () => {
        const house = await prisma.houses.create({
            data: { name: "Medication House", type: "BROODER", number: 501 },
        });
        houseId = house.id;
        const profile = await prisma.profiles.create({
            data: {
                name: "Med Recorder",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "ADMIN",
            },
        });
        profileId = profile.id;
        const batch = await prisma.batches.create({
            data: {
                batch_code: `MED-${crypto.randomUUID()}`,
                breed: "CLASSIC",
                expected_selling_date: new Date(Date.now() + 30 * 86400_000),
                initial_chick_count: 500,
                init_chicks_avg_wt: 40,
            },
        });
        batchId = batch.id;
    });

    afterAll(async () => {
        await prisma.medications.deleteMany({ where: { id: { in: createdIds } } });
        await prisma.batches.delete({ where: { id: batchId } });
        await prisma.houses.delete({ where: { id: houseId } });
        await prisma.profiles.delete({ where: { id: profileId } });
    });

    test("create then list by batch_id", async () => {
        const med = await MedicationService.create({
            batch_id: batchId,
            medicine_name: "Amoxicillin",
            dosage: "5ml per bird",
            administered_by_id: profileId,
        });
        createdIds.push(med!.id);

        const { medications } = await MedicationService.getAll({
            page: 1,
            limit: 100,
            batch_id: batchId,
        });
        expect(medications.some((m) => m.id === med!.id)).toBe(true);
    });

    test("create with nonexistent doctor_id throws bad-request, not a raw 500", async () => {
        await expect(
            MedicationService.create({
                batch_id: batchId,
                medicine_name: "Bad Doctor Ref",
                dosage: "1ml",
                administered_by_id: profileId,
                doctor_id: "00000000-0000-0000-0000-000000000000",
            }),
        ).rejects.toMatchObject({ status: 400 });
    });
});
