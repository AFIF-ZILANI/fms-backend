import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import {
    houseNumber,
    sharedWarehouseId,
    provisionPrinted,
    purgeAuditLog,
} from "@lib/test-fixtures";
import { BatchVaccineScheduleService as S } from "./batch-vaccine-schedule.service";
import { VaccineTemplateService } from "./vaccine-template.service";
import { StockUnitService } from "./stock-unit.service";

let houseId: string;
let houseYId: string;
let profileId: string;
let batchId: string;
let vaccineId: string;
let otherItemId: string;
let templateId: string;
// Its own purpose, so the suite doesn't depend on (or trip over edits to) the seeded ones.
const PURPOSE = `TEST_${crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
let purchaseId: string;
let lotId: string;
let otherLotId: string;
const unitIds: string[] = [];

/** A bottle of the vaccine, bound to the lot and moved into house X (or `where`; null = left in the warehouse). */
async function bottle(where: string | null = houseId, lot = () => lotId) {
    const [unit] = await provisionPrinted(1);
    unitIds.push(unit!.id);
    await StockUnitService.bind(unit!.id, { purchase_item_id: lot() });
    if (where) await StockUnitService.relocate(unit!.id, where, crypto.randomUUID());
    return unit!.id;
}

const confirm = (
    id: string,
    house_id: string,
    bottles: string[],
    key: string = crypto.randomUUID(),
) =>
    S.confirm(
        id,
        {
            idempotency_key: key,
            house_id,
            bottles: bottles.map((stock_unit_id) => ({
                stock_unit_id,
                quantity: 1,
                unit: "BOTTLE",
            })),
        },
        profileId,
    );

const row = (day: number) => S.create({ batch_id: batchId, purpose: PURPOSE, day }, profileId);

describe("BatchVaccineScheduleService", () => {
    beforeAll(async () => {
        await prisma.vaccinePurpose.create({ data: { code: PURPOSE, label: "Test purpose" } });
        houseId = (
            await prisma.houses.create({
                data: { name: "Vaccine House X", type: "GROWER", number: houseNumber() },
            })
        ).id;
        houseYId = (
            await prisma.houses.create({
                data: { name: "Vaccine House Y", type: "GROWER", number: houseNumber() },
            })
        ).id;
        profileId = (
            await prisma.profiles.create({
                data: {
                    name: "Vaccinator",
                    mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                    role: "ADMIN",
                },
            })
        ).id;
        const mkItem = (name: string, category: string) =>
            prisma.item.create({
                data: {
                    name: `${name} ${crypto.randomUUID()}`,
                    normalized_key: `${name} ${crypto.randomUUID()}`,
                    category,
                    unit: "BOTTLE",
                    is_unit_tracked: true,
                },
            });
        vaccineId = (await mkItem("ND Vaccine", "VACCINE")).id;
        otherItemId = (await mkItem("Antibiotic", "MEDICINE")).id;

        purchaseId = (
            await prisma.purchase.create({
                data: {
                    warehouse_id: await sharedWarehouseId(),
                    purchase_date: new Date(),
                    total_amount: 100,
                    paid_amount: 100,
                    due_amount: 0,
                    recorded_by_id: profileId,
                },
            })
        ).id;
        lotId = (
            await prisma.purchaseItem.create({
                data: {
                    purchase_id: purchaseId,
                    item_id: vaccineId,
                    quantity: 100,
                    unit: "BOTTLE",
                    base_quantity: 100,
                    unit_price: 1,
                    total_price: 100,
                },
            })
        ).id;

        otherLotId = (
            await prisma.purchaseItem.create({
                data: {
                    purchase_id: purchaseId,
                    item_id: otherItemId,
                    quantity: 10,
                    unit: "BOTTLE",
                    base_quantity: 10,
                    unit_price: 1,
                    total_price: 10,
                },
            })
        ).id;

        // Placed 4 days ago -> today is Day 5.
        batchId = (
            await prisma.batches.create({
                data: {
                    batch_code: `VSC-${crypto.randomUUID()}`,
                    breed: "TIGER",
                    starting_date: new Date(Date.now() - 4 * 86_400_000),
                    expected_selling_date: new Date(Date.now() + 30 * 86_400_000),
                    initial_chick_count: 500,
                    init_chicks_avg_wt: 40,
                },
            })
        ).id;
        await prisma.batchHouseBalance.create({
            data: { batch_id: batchId, house_id: houseId, quantity: 500 },
        });

        templateId = (
            await VaccineTemplateService.create({
                name: `Broiler ${crypto.randomUUID()}`,
                entries: [
                    { day: 9, purpose: PURPOSE },
                    { day: 5, purpose: PURPOSE, method: "EYE_DROP" },
                ],
            })
        ).id;
    });

    afterAll(async () => {
        await prisma.vaccinations.deleteMany({ where: { batch_id: batchId } });
        await prisma.consumption.deleteMany({ where: { batch_id: batchId } });
        await prisma.stockLedger.deleteMany({
            where: { item_id: { in: [vaccineId, otherItemId] } },
        });
        await prisma.stockHouseAllocation.deleteMany({ where: { stock_unit_id: { in: unitIds } } });
        await prisma.stockTransfer.deleteMany({
            where: { item_id: { in: [vaccineId, otherItemId] } },
        });
        await prisma.stockUnit.deleteMany({ where: { id: { in: unitIds } } });
        await prisma.purchaseItem.deleteMany({ where: { id: { in: [lotId, otherLotId] } } });
        await prisma.purchase.deleteMany({ where: { id: purchaseId } });
        await prisma.batchVaccineSchedule.deleteMany({ where: { batch_id: batchId } });
        await prisma.vaccineTemplate.deleteMany({ where: { id: templateId } });
        await prisma.vaccinePurpose.deleteMany({ where: { code: PURPOSE } });
        await purgeAuditLog({ where: { changed_by_id: profileId } });
        await prisma.batchHouseBalance.deleteMany({ where: { batch_id: batchId } });
        await prisma.batches.delete({ where: { id: batchId } });
        await prisma.item.deleteMany({ where: { id: { in: [vaccineId, otherItemId] } } });
        await prisma.houses.deleteMany({ where: { id: { in: [houseId, houseYId] } } });
        await prisma.profiles.delete({ where: { id: profileId } });
    });

    test("template entries come back sorted by day", async () => {
        const t = await VaccineTemplateService.getById(templateId);
        expect(t.entries.map((e) => e.day)).toEqual([5, 9]);
    });

    test("apply copies the rows once; a second apply is refused", async () => {
        const rows = await S.apply({ batch_id: batchId, template_id: templateId }, profileId);
        expect(rows.map((r) => [r.day, r.planned_day, r.status])).toEqual([
            [5, 5, "PENDING"],
            [9, 9, "PENDING"],
        ]);
        await expect(
            S.apply({ batch_id: batchId, template_id: templateId }, profileId),
        ).rejects.toThrow("already has a vaccine schedule");
    });

    test("reschedule moves day, keeps planned_day; cancel only while pending", async () => {
        const r = await row(6);
        const moved = await S.reschedule(r.id, { day: 8, reason: "Birds stressed" }, profileId);
        expect([moved.day, moved.planned_day, moved.reason]).toEqual([8, 6, "Birds stressed"]);
        const cancelled = await S.cancel(r.id, { reason: "Vet said skip" }, profileId);
        expect(cancelled.status).toBe("CANCELLED");
        await expect(S.reschedule(r.id, { day: 9, reason: "x" }, profileId)).rejects.toThrow(
            "cancelled",
        );
    });

    test("confirm before the day is refused", async () => {
        const r = await row(7);
        const b = await bottle();
        await expect(
            S.confirm(
                r.id,
                {
                    idempotency_key: crypto.randomUUID(),
                    house_id: houseId,
                    bottles: [{ stock_unit_id: b, quantity: 1, unit: "BOTTLE" }],
                },
                profileId,
            ),
        ).rejects.toThrow("due on day 7");
    });

    test("confirm with two bottles draws both, logs two vaccinations, and a retry is a no-op", async () => {
        const r = await row(5);
        const [b1, b2] = [await bottle(), await bottle()];
        const key = crypto.randomUUID();
        const body = {
            idempotency_key: key,
            house_id: houseId,
            bottles: [
                { stock_unit_id: b1, quantity: 1, unit: "BOTTLE" },
                { stock_unit_id: b2, quantity: 0.5, unit: "BOTTLE" },
            ],
        };
        const done = await S.confirm(r.id, body, profileId);
        expect(done.status).toBe("DONE");
        expect(done.confirmed_by?.id).toBe(profileId);
        expect(done.vaccinations).toHaveLength(2);

        const again = await S.confirm(r.id, body, profileId);
        expect(again.status).toBe("DONE");
        expect(await prisma.vaccinations.count({ where: { schedule_id: r.id } })).toBe(2);
        expect(await prisma.consumption.count({ where: { stock_unit_id: { in: [b1, b2] } } })).toBe(
            2,
        );
    });

    test("one bad bottle rolls the whole confirm back", async () => {
        const r = await row(5);
        const good = await bottle();
        const warehouse = await bottle(null);
        await expect(
            S.confirm(
                r.id,
                {
                    idempotency_key: crypto.randomUUID(),
                    house_id: houseId,
                    bottles: [
                        { stock_unit_id: good, quantity: 1, unit: "BOTTLE" },
                        { stock_unit_id: warehouse, quantity: 1, unit: "BOTTLE" },
                    ],
                },
                profileId,
            ),
        ).rejects.toThrow("move it there first");
        const after = await prisma.batchVaccineSchedule.findUniqueOrThrow({ where: { id: r.id } });
        expect(after.status).toBe("PENDING");
        expect(await prisma.consumption.count({ where: { stock_unit_id: good } })).toBe(0);
    });

    test("a bottle that isn't a vaccine is refused", async () => {
        const r = await row(5);
        const b = await bottle(houseId, () => otherLotId);
        await expect(
            S.confirm(
                r.id,
                {
                    idempotency_key: crypto.randomUUID(),
                    house_id: houseId,
                    bottles: [{ stock_unit_id: b, quantity: 1, unit: "BOTTLE" }],
                },
                profileId,
            ),
        ).rejects.toThrow("isn't a vaccine");
    });

    // From here on the batch is split across houses X and Y.
    test("a split batch is DONE only once every house has confirmed, each from its own bottles", async () => {
        await prisma.batchHouseBalance.create({
            data: { batch_id: batchId, house_id: houseYId, quantity: 400 },
        });
        const r = await row(5);

        const inX = await bottle(houseId);
        await expect(confirm(r.id, houseYId, [inX])).rejects.toThrow("move it there first");

        const afterX = await confirm(r.id, houseId, [await bottle(houseId)]);
        expect(afterX.status).toBe("PENDING");
        expect(afterX.houses.map((h) => [h.id, !!h.confirm])).toEqual(
            expect.arrayContaining([
                [houseId, true],
                [houseYId, false],
            ]),
        );
        await expect(confirm(r.id, houseId, [await bottle(houseId)])).rejects.toThrow(
            "already confirmed",
        );

        const yBottle = await bottle(houseYId);
        const key = crypto.randomUUID();
        const afterY = await confirm(r.id, houseYId, [yBottle], key);
        expect(afterY.status).toBe("DONE");
        expect(afterY.houses.every((h) => h.confirm)).toBe(true);
        // The draw is booked to the house that used it.
        const draw = await prisma.consumption.findFirstOrThrow({
            where: { stock_unit_id: yBottle },
        });
        expect(draw.house_id).toBe(houseYId);

        // A retry of Y's confirm is a no-op, not a second draw.
        expect((await confirm(r.id, houseYId, [yBottle], key)).status).toBe("DONE");
        expect(await prisma.consumption.count({ where: { stock_unit_id: yBottle } })).toBe(1);
    });

    test("a house the batch isn't in can't confirm", async () => {
        const r = await row(5);
        const empty = await prisma.houses.create({
            data: { name: "Empty House", type: "GROWER", number: houseNumber() },
        });
        try {
            await expect(confirm(r.id, empty.id, [await bottle(houseId)])).rejects.toThrow(
                "no birds in that house",
            );
        } finally {
            await prisma.houses.delete({ where: { id: empty.id } });
        }
    });

    test("a house that empties after the others confirmed closes the row on read", async () => {
        const r = await row(5);
        await confirm(r.id, houseId, [await bottle(houseId)]);
        await prisma.batchHouseBalance.updateMany({
            where: { batch_id: batchId, house_id: houseYId },
            data: { quantity: 0 },
        });
        const listed = (await S.getAll(batchId)).find((x) => x.id === r.id)!;
        expect(listed.status).toBe("DONE");
        expect(
            (await prisma.batchVaccineSchedule.findUniqueOrThrow({ where: { id: r.id } })).status,
        ).toBe("DONE");
    });
});
