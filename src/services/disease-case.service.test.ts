import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { DiseaseCaseService } from "./disease-case.service";
import { MortalityLogService } from "./mortality-log.service";
import { MedicationService } from "./medication.service";
import { AlertService } from "./alert.service";
import { updateDiseaseCaseSchema } from "@validators/disease-case.validator";
import { houseNumber, purgeAuditLog } from "@lib/test-fixtures";

const houseIds: string[] = [];
const batchIds: string[] = [];
let profileId: string;
let diseaseId: string;

const newBatch = (code: string) =>
    prisma.batches.create({
        data: {
            batch_code: `${code}-${crypto.randomUUID()}`,
            breed: "CLASSIC",
            expected_selling_date: new Date(Date.now() + 30 * 86400_000),
            initial_chick_count: 500,
            init_chicks_avg_wt: 40,
        },
    });

describe("DiseaseCaseService", () => {
    let batchId: string;
    let otherBatchId: string;
    let houseA: string;
    let houseB: string; // never held the batch

    beforeAll(async () => {
        for (const name of ["Disease House A", "Disease House B"]) {
            const h = await prisma.houses.create({
                data: { name, type: "BROODER", number: houseNumber() },
            });
            houseIds.push(h.id);
        }
        [houseA, houseB] = houseIds as [string, string];
        profileId = (
            await prisma.profiles.create({
                data: {
                    name: "Disease Recorder",
                    mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                    role: "ADMIN",
                },
            })
        ).id;
        diseaseId = (
            await prisma.disease.create({
                data: { code: `TEST_${crypto.randomUUID()}`, label: "Test pox" },
            })
        ).id;
        batchId = (await newBatch("DIS")).id;
        otherBatchId = (await newBatch("DIS2")).id;
        batchIds.push(batchId, otherBatchId);
        await prisma.batchHouseBalance.create({
            data: { batch_id: batchId, house_id: houseA, quantity: 500 },
        });
    });

    afterAll(async () => {
        await prisma.alerts.deleteMany({ where: { related_id: { in: batchIds } } });
        await prisma.medications.deleteMany({ where: { batch_id: { in: batchIds } } });
        await prisma.mortalityLog.deleteMany({ where: { batch_id: { in: batchIds } } });
        await prisma.diseaseCase.deleteMany({ where: { batch_id: { in: batchIds } } });
        await purgeAuditLog({ where: { changed_by_id: profileId } });
        await prisma.batchHouseBalance.deleteMany({ where: { batch_id: { in: batchIds } } });
        await prisma.batches.deleteMany({ where: { id: { in: batchIds } } });
        await prisma.houses.deleteMany({ where: { id: { in: houseIds } } });
        await prisma.disease.delete({ where: { id: diseaseId } });
        await prisma.profiles.delete({ where: { id: profileId } });
    });

    const base = () => ({
        batch_id: batchId,
        disease_id: diseaseId,
        house_ids: [houseA],
        severity: "HIGH" as const,
        diagnosis_method: "FIELD" as const,
        noticed_on: new Date("2026-11-01"),
        recorded_by_id: profileId,
    });

    test("refuses a house the batch was never in", async () => {
        await expect(
            DiseaseCaseService.create({ ...base(), house_ids: [houseA, houseB] }),
        ).rejects.toMatchObject({
            status: 400,
        });
    });

    test("full case: link deaths + treatment, totals, alert, resolve, reopen, delete", async () => {
        const created = await DiseaseCaseService.create({ ...base(), symptoms: ["Coughing"] });
        expect(created.houses.map((h) => h.id)).toEqual([houseA]);

        await MortalityLogService.create({
            batch_id: batchId,
            house_id: houseA,
            count_died: 7,
            date: new Date("2026-11-02"),
            disease_case_id: created.id,
            recorded_by_id: profileId,
        });
        await MedicationService.create({
            batch_id: batchId,
            medicine_name: "Tylosin",
            dosage: "1g/L",
            disease_case_id: created.id,
            administered_by_id: profileId,
        });
        // A treatment for another batch can't point at this case.
        await expect(
            MedicationService.create({
                batch_id: otherBatchId,
                medicine_name: "Tylosin",
                dosage: "1g/L",
                disease_case_id: created.id,
                administered_by_id: profileId,
            }),
        ).rejects.toMatchObject({ status: 400 });

        const { cases } = await DiseaseCaseService.getAll({
            page: 1,
            limit: 10,
            batch_id: batchId,
        });
        expect(cases[0]).toMatchObject({ id: created.id, deaths: 7, treatments: 1 });
        const one = await DiseaseCaseService.getById(created.id);
        expect(one.mortalityLogs).toHaveLength(1);
        expect(one.medications).toHaveLength(1);

        await AlertService.runScan();
        const alert = await prisma.alerts.findFirst({
            where: { dedupe_key: `DISEASE:${created.id}`, status: "ACTIVE" },
        });
        expect(alert?.level).toBe("CRITICAL");

        // Resolving needs a date and outcome, and the date can't precede noticed_on.
        expect(updateDiseaseCaseSchema.safeParse({ status: "RESOLVED" }).success).toBe(false);
        await expect(
            DiseaseCaseService.update(created.id, {
                status: "RESOLVED",
                resolved_on: new Date("2026-10-30"),
                outcome: "RECOVERED",
            }),
        ).rejects.toMatchObject({ status: 400 });
        const resolved = await DiseaseCaseService.update(created.id, {
            status: "RESOLVED",
            resolved_on: new Date("2026-11-06"),
            outcome: "RECOVERED",
        });
        expect(resolved.status).toBe("RESOLVED");

        await AlertService.runScan();
        expect(
            await prisma.alerts.count({
                where: { dedupe_key: `DISEASE:${created.id}`, status: "ACTIVE" },
            }),
        ).toBe(0);

        const reopened = await DiseaseCaseService.update(created.id, { status: "ACTIVE" });
        expect(reopened).toMatchObject({ status: "ACTIVE", resolved_on: null, outcome: null });

        await DiseaseCaseService.remove(created.id, profileId);
        const log = await prisma.mortalityLog.findFirst({ where: { batch_id: batchId } });
        expect(log?.disease_case_id).toBeNull(); // the death stays, unlinked
        expect(
            await prisma.auditLog.count({ where: { record_id: created.id, action: "DELETE" } }),
        ).toBe(1);
    });

    test("an admin links a forgotten death only to a case active that day, in that house", async () => {
        const c = await DiseaseCaseService.create({
            ...base(),
            noticed_on: new Date("2026-11-03"),
        });
        await DiseaseCaseService.update(c.id, {
            status: "RESOLVED",
            resolved_on: new Date("2026-11-05"),
            outcome: "RECOVERED",
        });
        const death = (date: string) =>
            MortalityLogService.create({
                batch_id: batchId,
                house_id: houseA,
                count_died: 1,
                date: new Date(date),
                recorded_by_id: profileId,
            });
        const [before, during, after] = await Promise.all([
            death("2026-11-02T10:00:00Z"),
            death("2026-11-05T10:00:00Z"),
            death("2026-11-06T10:00:00Z"),
        ]);

        for (const log of [before, after])
            await expect(
                MortalityLogService.setDiseaseCase(log.id, c.id, profileId),
            ).rejects.toMatchObject({ status: 400 });
        expect(
            (await MortalityLogService.setDiseaseCase(during.id, c.id, profileId)).disease_case_id,
        ).toBe(c.id);

        const other = await DiseaseCaseService.create({
            ...base(),
            batch_id: otherBatchId,
            house_ids: [],
        });
        await expect(
            MortalityLogService.setDiseaseCase(during.id, other.id, profileId),
        ).rejects.toMatchObject({ status: 400 });

        expect(
            (await MortalityLogService.setDiseaseCase(during.id, null, profileId)).disease_case_id,
        ).toBeNull();
        expect(
            await prisma.auditLog.count({ where: { record_id: during.id, action: "UPDATE" } }),
        ).toBe(2);
    });
});
