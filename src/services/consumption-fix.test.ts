import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import {
    houseNumber,
    sharedWarehouseId,
    provisionPrinted,
    purgeAuditLog,
} from "@lib/test-fixtures";
import { ConsumptionService as C } from "./consumption.service";
import { StockUnitService } from "./stock-unit.service";
import { BatchVaccineScheduleService as S } from "./batch-vaccine-schedule.service";
import { houseActivity } from "./house-activity.service";

let houseId: string;
// On the same drinker line as houseId: a vaccine confirm in one covers both.
let houseYId: string;
let profileId: string;
// An earlier batch in the same house: placed 20 days ago, ended 10 days ago.
let oldBatchId: string;
let med2Id: string;
let med2Lot: string;
let equipId: string;
let equipLot: string;
// A lot with no unit_count yet: only the lot's total limits a draw.
let looseLot: string;
let batchId: string;
let feedId: string;
let medId: string;
let vaccineId: string;
let purchaseId: string;
let medLot: string;
let vaccineLot: string;
const PURPOSE = `TEST_${crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
const unitIds: string[] = [];

const fix = (id: string, body: Record<string, unknown>) =>
    C.fix(id, { reason: "test", actor_id: profileId, ...body } as Parameters<typeof C.fix>[1]);
const remove = (id: string) => C.remove(id, { reason: "test", actor_id: profileId });
const ledgerOf = (id: string) =>
    prisma.stockLedger.findMany({ where: { ref_type: "CONSUMPTION", ref_id: id } });
const statusOf = async (unit: string) =>
    (await prisma.stockUnit.findUniqueOrThrow({ where: { id: unit } })).status;

async function bottle(lot: string, where: string = houseId) {
    const [unit] = await provisionPrinted(1);
    unitIds.push(unit!.id);
    await StockUnitService.bind(unit!.id, { purchase_item_id: lot });
    await StockUnitService.relocate(unit!.id, where, crypto.randomUUID());
    return unit!.id;
}

const use = (body: { item_id: string; quantity: number; unit: string; stock_unit_id?: string }) =>
    C.create({
        ...body,
        house_id: houseId,
        batch_id: batchId,
        date: new Date(),
        recorded_by_id: profileId,
    });

async function houseFeed(kg: number) {
    await prisma.stockLedger.create({
        data: {
            item_id: feedId,
            quantity: kg,
            direction: "IN",
            reason: "TRANSFER",
            ref_type: "TRANSFER",
            ref_id: crypto.randomUUID(),
            idempotency_key: crypto.randomUUID(),
            location_type: "HOUSE",
            location_id: houseId,
        },
    });
}

describe("Fix usage", () => {
    beforeAll(async () => {
        const line = `fix-line-${crypto.randomUUID()}`;
        houseId = (
            await prisma.houses.create({
                data: {
                    name: "Fix House",
                    type: "GROWER",
                    number: houseNumber(),
                    water_line: line,
                },
            })
        ).id;
        houseYId = (
            await prisma.houses.create({
                data: {
                    name: "Fix House Y",
                    type: "GROWER",
                    number: houseNumber(),
                    water_line: line,
                },
            })
        ).id;
        profileId = (
            await prisma.profiles.create({
                data: {
                    name: "Fixer",
                    mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                    role: "ADMIN",
                },
            })
        ).id;
        const mk = (name: string, category: string, unit: string, coded: boolean) =>
            prisma.item.create({
                data: {
                    name: `${name} ${crypto.randomUUID()}`,
                    normalized_key: `${name} ${crypto.randomUUID()}`,
                    category,
                    unit,
                    is_unit_tracked: coded,
                },
            });
        feedId = (await mk("Fix Feed", "FEED", "KG", false)).id;
        await prisma.itemUnit.create({
            data: {
                item_id: feedId,
                unit: "BAG",
                factor_to_base: 50,
                is_usable: true,
                is_purchasable: true,
            },
        });
        medId = (await mk("Fix Med", "MEDICINE", "ML", true)).id;
        vaccineId = (await mk("Fix Vaccine", "VACCINE", "ML", true)).id;
        purchaseId = (
            await prisma.purchase.create({
                data: {
                    warehouse_id: await sharedWarehouseId(),
                    purchase_date: new Date(),
                    total_amount: 0,
                    paid_amount: 0,
                    due_amount: 0,
                    recorded_by_id: profileId,
                },
            })
        ).id;
        // 30 bottles of 100 ml each.
        const lot = (item_id: string) =>
            prisma.purchaseItem.create({
                data: {
                    purchase_id: purchaseId,
                    item_id,
                    quantity: 30,
                    unit: "BOTTLE",
                    base_quantity: 3000,
                    unit_count: 30,
                    unit_price: 1,
                    total_price: 10,
                },
            });
        medLot = (await lot(medId)).id;
        vaccineLot = (await lot(vaccineId)).id;
        med2Id = (await mk("Fix Med Two", "MEDICINE", "ML", true)).id;
        med2Lot = (await lot(med2Id)).id;
        equipId = (await mk("Fix Heater", "EQUIPMENT", "PCS", true)).id;
        equipLot = (
            await prisma.purchaseItem.create({
                data: {
                    purchase_id: purchaseId,
                    item_id: equipId,
                    quantity: 2,
                    unit: "PCS",
                    base_quantity: 2,
                    unit_count: 2,
                    unit_price: 1,
                    total_price: 2,
                },
            })
        ).id;
        looseLot = (
            await prisma.purchaseItem.create({
                data: {
                    purchase_id: purchaseId,
                    item_id: medId,
                    quantity: 1,
                    unit: "ML",
                    base_quantity: 50,
                    unit_price: 1,
                    total_price: 1,
                },
            })
        ).id;

        // Placed 4 days ago -> today is Day 5.
        batchId = (
            await prisma.batches.create({
                data: {
                    batch_code: `FIX-${crypto.randomUUID()}`,
                    breed: "TIGER",
                    starting_date: new Date(Date.now() - 4 * 86_400_000),
                    expected_selling_date: new Date(Date.now() + 30 * 86_400_000),
                    initial_chick_count: 500,
                },
            })
        ).id;
        await prisma.batchHouseBalance.create({
            data: { batch_id: batchId, house_id: houseId, quantity: 500 },
        });
        await prisma.batchHouseAllocation.create({
            data: {
                batch_id: batchId,
                to_house_id: houseId,
                quantity: 500,
                reason: "INITIAL",
                recorded_by_id: profileId,
                occurred_at: new Date(Date.now() - 4 * 86_400_000),
                idempotency_key: crypto.randomUUID(),
            },
        });
        // The house's other birds share the drinker line, so a confirm in one house covers both.
        await prisma.batchHouseBalance.create({
            data: { batch_id: batchId, house_id: houseYId, quantity: 100 },
        });
        oldBatchId = (
            await prisma.batches.create({
                data: {
                    batch_code: `FIX-OLD-${crypto.randomUUID()}`,
                    breed: "TIGER",
                    status: "SOLD",
                    starting_date: new Date(Date.now() - 20 * 86_400_000),
                    expected_selling_date: new Date(Date.now() - 10 * 86_400_000),
                    actual_end_date: new Date(Date.now() - 10 * 86_400_000),
                    initial_chick_count: 300,
                },
            })
        ).id;
        await prisma.batchHouseAllocation.create({
            data: {
                batch_id: oldBatchId,
                to_house_id: houseId,
                quantity: 300,
                reason: "INITIAL",
                recorded_by_id: profileId,
                occurred_at: new Date(Date.now() - 20 * 86_400_000),
                idempotency_key: crypto.randomUUID(),
            },
        });
        await prisma.vaccinePurpose.create({ data: { code: PURPOSE, label: "Fix test purpose" } });
    });

    afterAll(async () => {
        const items = [feedId, medId, vaccineId, med2Id, equipId];
        const batches = [batchId, oldBatchId];
        await prisma.vaccinations.deleteMany({ where: { batch_id: { in: batches } } });
        await prisma.medications.deleteMany({ where: { batch_id: { in: batches } } });
        await prisma.consumption.deleteMany({ where: { item_id: { in: items } } });
        await prisma.batchVaccineSchedule.deleteMany({ where: { batch_id: batchId } });
        await prisma.stockLedger.deleteMany({ where: { item_id: { in: items } } });
        await prisma.stockHouseAllocation.deleteMany({ where: { stock_unit_id: { in: unitIds } } });
        await prisma.stockTransfer.deleteMany({ where: { item_id: { in: items } } });
        await prisma.stockUnit.deleteMany({ where: { id: { in: unitIds } } });
        await prisma.purchaseItem.deleteMany({ where: { purchase_id: purchaseId } });
        await prisma.purchase.deleteMany({ where: { id: purchaseId } });
        await prisma.itemUnit.deleteMany({ where: { item_id: { in: items } } });
        await prisma.item.deleteMany({ where: { id: { in: items } } });
        await prisma.vaccinePurpose.deleteMany({ where: { code: PURPOSE } });
        await purgeAuditLog({ where: { changed_by_id: profileId } });
        await prisma.batchHouseBalance.deleteMany({ where: { batch_id: { in: batches } } });
        await prisma.batchHouseAllocation.deleteMany({ where: { batch_id: { in: batches } } });
        await prisma.weightRecords.deleteMany({ where: { batch_id: { in: batches } } });
        await prisma.batches.deleteMany({ where: { id: { in: batches } } });
        await prisma.houses.deleteMany({ where: { id: { in: [houseId, houseYId] } } });
        await prisma.profiles.delete({ where: { id: profileId } });
    });

    test("feed: 2 kg fixed to 2 bag needs exactly the extra 98 kg, and is marked and audited", async () => {
        await houseFeed(100);
        const c = await use({ item_id: feedId, quantity: 2, unit: "KG" });
        // 98 kg left in the house: exactly the increase.
        const fixed = await fix(c.id, { unit: "BAG" });
        expect([fixed.unit, Number(fixed.quantity), Number(fixed.base_quantity)]).toEqual([
            "BAG",
            2,
            100,
        ]);
        expect(fixed.fixed_by_id).toBe(profileId);
        expect(fixed.fix_reason).toBe("test");
        expect((await ledgerOf(c.id)).map((l) => Number(l.quantity))).toEqual([100]);
        const log = await prisma.auditLog.findFirstOrThrow({
            where: { record_id: c.id, action: "UPDATE" },
        });
        expect((log.before_data as { unit: string }).unit).toBe("KG");

        // Nothing left: one bag more is refused, one bag less gives 50 kg back.
        await expect(fix(c.id, { quantity: 3 })).rejects.toThrow("Only 0 more");
        await fix(c.id, { quantity: 1 });
        expect((await ledgerOf(c.id)).map((l) => Number(l.quantity))).toEqual([50]);

        await remove(c.id);
        expect(await prisma.consumption.findUnique({ where: { id: c.id } })).toBeNull();
        expect(await ledgerOf(c.id)).toEqual([]);
        expect(await prisma.auditLog.count({ where: { record_id: c.id, action: "DELETE" } })).toBe(
            1,
        );
    });

    test("a SOLD batch can be fixed, a CLOSED one can't; no future dates", async () => {
        await houseFeed(10);
        const c = await use({ item_id: feedId, quantity: 5, unit: "KG" });
        await prisma.batches.update({ where: { id: batchId }, data: { status: "SOLD" } });
        await fix(c.id, { quantity: 4 });
        await prisma.batches.update({ where: { id: batchId }, data: { status: "CLOSED" } });
        await expect(fix(c.id, { quantity: 3 })).rejects.toThrow("finalised");
        await expect(remove(c.id)).rejects.toThrow("finalised");
        await prisma.batches.update({ where: { id: batchId }, data: { status: "RUNNING" } });
        await expect(fix(c.id, { date: new Date(Date.now() + 86_400_000) })).rejects.toThrow(
            "future",
        );
        const moved = await fix(c.id, { date: new Date(Date.now() - 86_400_000) });
        expect(moved.batch_id).toBe(batchId);
        await remove(c.id);
    });

    test("typed dose: raised to exactly what's left, then the bottle is swapped", async () => {
        const [b1, b2] = [await bottle(medLot), await bottle(medLot)];
        const c = await use({ item_id: medId, quantity: 30, unit: "ML", stock_unit_id: b1 });
        // 70 left + this record's 30 = the whole 100 ml bottle.
        await expect(fix(c.id, { quantity: 101 })).rejects.toThrow(
            "Only 100 is left in this bottle",
        );
        await fix(c.id, { quantity: 100 });

        const given = new Date(Date.now() - 2 * 3_600_000);
        const med = await prisma.medications.create({
            data: {
                batch_id: batchId,
                consumption_id: c.id,
                medicine_name: "Fix Med",
                dosage: "100 ml",
                administered_by_id: profileId,
                date: given,
                idempotency_key: crypto.randomUUID(),
            },
        });
        const swapped = await fix(c.id, { stock_unit_id: b2 });
        // Only the bottle changed: the treatment keeps its own date.
        expect(
            (await prisma.medications.findUniqueOrThrow({ where: { id: med.id } })).date,
        ).toEqual(given);
        expect(swapped.stock_unit_id).toBe(b2);
        expect([await statusOf(b1), await statusOf(b2)]).toEqual(["BOUND", "IN_USE"]);
        expect((await ledgerOf(c.id)).map((l) => Number(l.quantity))).toEqual([100]);
    });

    test("used-up bottle: amount is locked, a swap uses the new bottle up and frees the old one", async () => {
        const [b3, b4] = [await bottle(medLot), await bottle(medLot)];
        await StockUnitService.use(b3, {
            action: "FINISH",
            house_id: houseId,
            batch_id: batchId,
            date: new Date(),
            recorded_by_id: profileId,
        });
        const c = await prisma.consumption.findFirstOrThrow({ where: { stock_unit_id: b3 } });
        await expect(fix(c.id, { quantity: 10 })).rejects.toThrow("used up");
        const swapped = await fix(c.id, { stock_unit_id: b4 });
        expect(Number(swapped.base_quantity)).toBe(100);
        expect([await statusOf(b3), await statusOf(b4)]).toEqual(["BOUND", "CONSUMED"]);
    });

    test("a bottle marked used up by hand, or sold, can't take a dose back", async () => {
        const b5 = await bottle(medLot);
        const c = await use({ item_id: medId, quantity: 10, unit: "ML", stock_unit_id: b5 });
        await StockUnitService.setStatus(b5, "CONSUMED");
        await expect(fix(c.id, { quantity: 5 })).rejects.toThrow("marked used up by hand");
        await expect(remove(c.id)).rejects.toThrow("marked used up by hand");
        // The date isn't a dose: still fixable.
        await fix(c.id, { date: new Date(Date.now() - 3_600_000) });

        const b6 = await bottle(medLot);
        const d = await use({ item_id: medId, quantity: 10, unit: "ML", stock_unit_id: b6 });
        await prisma.stockUnit.update({ where: { id: b6 }, data: { status: "SOLD" } });
        await expect(remove(d.id)).rejects.toThrow("sold");
    });

    test("removing a use takes its treatment, and a schedule confirm goes back to pending", async () => {
        const b7 = await bottle(medLot);
        const c = await use({ item_id: medId, quantity: 10, unit: "ML", stock_unit_id: b7 });
        await prisma.medications.create({
            data: {
                batch_id: batchId,
                consumption_id: c.id,
                medicine_name: "Fix Med",
                dosage: "10 ml",
                administered_by_id: profileId,
                idempotency_key: crypto.randomUUID(),
            },
        });
        await remove(c.id);
        expect(await prisma.medications.count({ where: { consumption_id: c.id } })).toBe(0);
        expect(await statusOf(b7)).toBe("BOUND");

        const row = await S.create({ batch_id: batchId, purpose: PURPOSE, day: 5 }, profileId);
        const b8 = await bottle(vaccineLot);
        const done = await S.confirm(
            row.id,
            {
                idempotency_key: crypto.randomUUID(),
                house_id: houseId,
                bottles: [{ stock_unit_id: b8 }],
            },
            profileId,
        );
        expect(done.status).toBe("DONE");
        const v = await prisma.consumption.findFirstOrThrow({ where: { stock_unit_id: b8 } });
        // A schedule use can't move to another batch, but the same batch's day is fine.
        await fix(v.id, { date: new Date(Date.now() - 3_600_000) });

        await remove(v.id);
        expect(await prisma.vaccinations.count({ where: { consumption_id: v.id } })).toBe(0);
        expect(
            await prisma.batchVaccineHouseConfirm.count({ where: { schedule_id: row.id } }),
        ).toBe(0);
        const reopened = await prisma.batchVaccineSchedule.findUniqueOrThrow({
            where: { id: row.id },
        });
        expect([reopened.status, reopened.confirmed_at]).toEqual(["PENDING", null]);
        expect(await statusOf(b8)).toBe("BOUND");
    });

    test("a fixed record says so in the house history and on its own read", async () => {
        await houseFeed(5);
        const c = await use({ item_id: feedId, quantity: 5, unit: "KG" });
        await fix(c.id, { quantity: 4 });
        const one = await C.getById(c.id);
        expect([one.fixed_by?.name, one.fix_reason, one.batch?.status]).toEqual([
            "Fixer",
            "test",
            "RUNNING",
        ]);
        const { activity } = await houseActivity(houseId, { page: 1, limit: 50 });
        const row = activity.find((e) => e.id === c.id);
        expect([row?.fixed?.by, row?.fixed?.reason]).toEqual(["Fixer", "test"]);
        await remove(c.id);
    });
    test("a date in an earlier batch moves the record and its treatment there; a closed one refuses", async () => {
        const b = await bottle(medLot);
        const c = await use({ item_id: medId, quantity: 5, unit: "ML", stock_unit_id: b });
        const med = await prisma.medications.create({
            data: {
                batch_id: batchId,
                consumption_id: c.id,
                medicine_name: "Fix Med",
                dosage: "5 ml",
                administered_by_id: profileId,
                idempotency_key: crypto.randomUUID(),
            },
        });
        const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);
        // 7 days ago nobody was in the house: a use with a treatment can't be left without a batch.
        await expect(fix(c.id, { date: daysAgo(7) })).rejects.toThrow("No batch was in this house");
        // 12 days ago the old batch was there and is still in its settlement window.
        const moved = await fix(c.id, { date: daysAgo(12) });
        expect(moved.batch_id).toBe(oldBatchId);
        expect(
            (await prisma.medications.findUniqueOrThrow({ where: { id: med.id } })).batch_id,
        ).toBe(oldBatchId);
        // Once the old batch is closed, nothing can move into it or out of it.
        await fix(c.id, { date: daysAgo(1) });
        await prisma.batches.update({ where: { id: oldBatchId }, data: { status: "CLOSED" } });
        await expect(fix(c.id, { date: daysAgo(12) })).rejects.toThrow("finalised");
        await prisma.batches.update({ where: { id: oldBatchId }, data: { status: "SOLD" } });
        await remove(c.id);
    });

    test("without links, a day with no batch leaves the record without one", async () => {
        await houseFeed(3);
        const c = await use({ item_id: feedId, quantity: 3, unit: "KG" });
        const moved = await fix(c.id, { date: new Date(Date.now() - 7 * 86_400_000) });
        expect(moved.batch_id).toBeNull();
        await remove(c.id);
    });

    test("a new time on the same day keeps the record's batch", async () => {
        await houseFeed(3);
        const c = await use({ item_id: feedId, quantity: 3, unit: "KG" });
        const moved = await fix(c.id, { date: new Date(new Date(c.date).getTime() - 60_000) });
        expect(moved.batch_id).toBe(batchId);
        await remove(c.id);
    });

    test("swaps: another house's bottle, a used-up one, or a non-vaccine for a schedule use are refused", async () => {
        const [here, there, empty] = [
            await bottle(medLot),
            await bottle(medLot, houseYId),
            await bottle(medLot),
        ];
        const c = await use({ item_id: medId, quantity: 5, unit: "ML", stock_unit_id: here });
        await expect(fix(c.id, { stock_unit_id: there })).rejects.toThrow("move it there first");
        await StockUnitService.use(empty, {
            action: "FINISH",
            house_id: houseId,
            batch_id: batchId,
            date: new Date(),
            recorded_by_id: profileId,
        });
        await expect(fix(c.id, { stock_unit_id: empty })).rejects.toThrow("consumed");
        await expect(fix(c.id, { stock_unit_id: crypto.randomUUID() })).rejects.toThrow();
        await remove(c.id);

        const row = await S.create({ batch_id: batchId, purpose: PURPOSE, day: 5 }, profileId);
        const v = await bottle(vaccineLot);
        await S.confirm(
            row.id,
            {
                idempotency_key: crypto.randomUUID(),
                house_id: houseId,
                bottles: [{ stock_unit_id: v }],
            },
            profileId,
        );
        const draw = await prisma.consumption.findFirstOrThrow({ where: { stock_unit_id: v } });
        await expect(fix(draw.id, { stock_unit_id: await bottle(medLot) })).rejects.toThrow(
            "isn't a vaccine",
        );
        await remove(draw.id);
    });

    test("a bottle of another medicine: the record, its ledger row and its treatment follow the new item", async () => {
        const [b, other] = [await bottle(medLot), await bottle(med2Lot)];
        const c = await use({ item_id: medId, quantity: 20, unit: "ML", stock_unit_id: b });
        await prisma.medications.create({
            data: {
                batch_id: batchId,
                consumption_id: c.id,
                medicine_name: "Fix Med",
                dosage: "20 ml",
                administered_by_id: profileId,
                idempotency_key: crypto.randomUUID(),
            },
        });
        const swapped = await fix(c.id, { stock_unit_id: other });
        expect([swapped.item_id, Number(swapped.base_quantity)]).toEqual([med2Id, 20]);
        expect((await ledgerOf(c.id)).map((l) => l.item_id)).toEqual([med2Id]);
        const med = await prisma.medications.findFirstOrThrow({ where: { consumption_id: c.id } });
        expect(med.medicine_name.startsWith("Fix Med Two")).toBe(true);
        await remove(c.id);
    });

    test("equipment: no amount to fix, and removing it frees the unit", async () => {
        const heater = await bottle(equipLot);
        const c = await use({ item_id: equipId, quantity: 1, unit: "PCS", stock_unit_id: heater });
        expect(await ledgerOf(c.id)).toEqual([]);
        await expect(fix(c.id, { quantity: 2 })).rejects.toThrow("Equipment has no amount");
        await remove(c.id);
        expect(await statusOf(heater)).toBe("BOUND");
    });

    test("an earlier draw from a bottle a later record used up is locked", async () => {
        const b = await bottle(medLot);
        const first = await use({ item_id: medId, quantity: 10, unit: "ML", stock_unit_id: b });
        await StockUnitService.use(b, {
            action: "FINISH",
            house_id: houseId,
            batch_id: batchId,
            date: new Date(),
            recorded_by_id: profileId,
        });
        await expect(fix(first.id, { quantity: 5 })).rejects.toThrow("used up by a later record");
        await expect(remove(first.id)).rejects.toThrow("used up by a later record");
    });

    test("a lot with no unit count is limited by the lot's total only", async () => {
        const b = await bottle(looseLot);
        const c = await use({ item_id: medId, quantity: 30, unit: "ML", stock_unit_id: b });
        await expect(fix(c.id, { quantity: 51 })).rejects.toThrow("Only 50 is left in this lot");
        await fix(c.id, { quantity: 50 });
        await remove(c.id);
    });

    test("bad input: no codes on feed, a unit the item can't be used in, an unknown record", async () => {
        await houseFeed(2);
        const c = await use({ item_id: feedId, quantity: 2, unit: "KG" });
        await expect(fix(c.id, { stock_unit_id: crypto.randomUUID() })).rejects.toThrow("no codes");
        await expect(fix(c.id, { unit: "ML" })).rejects.toThrow();
        await expect(fix(crypto.randomUUID(), { quantity: 1 })).rejects.toThrow("not found");
        await expect(remove(crypto.randomUUID())).rejects.toThrow("not found");
        await remove(c.id);
    });

    test("removing one of two bottles keeps the confirm; the last one reopens it on both houses of the line", async () => {
        const row = await S.create({ batch_id: batchId, purpose: PURPOSE, day: 5 }, profileId);
        const [v1, v2] = [await bottle(vaccineLot), await bottle(vaccineLot)];
        const done = await S.confirm(
            row.id,
            {
                idempotency_key: crypto.randomUUID(),
                house_id: houseId,
                bottles: [{ stock_unit_id: v1 }, { stock_unit_id: v2 }],
            },
            profileId,
        );
        expect(done.status).toBe("DONE");
        // House Y was covered through house X's drinker line.
        const confirms = () =>
            prisma.batchVaccineHouseConfirm.findMany({ where: { schedule_id: row.id } });
        expect((await confirms()).map((x) => x.house_id).sort()).toEqual(
            [houseId, houseYId].sort(),
        );

        await remove(
            (await prisma.consumption.findFirstOrThrow({ where: { stock_unit_id: v1 } })).id,
        );
        expect((await confirms()).length).toBe(2);
        expect(
            (await prisma.batchVaccineSchedule.findUniqueOrThrow({ where: { id: row.id } })).status,
        ).toBe("DONE");

        await remove(
            (await prisma.consumption.findFirstOrThrow({ where: { stock_unit_id: v2 } })).id,
        );
        expect(await confirms()).toEqual([]);
        expect(
            (await prisma.batchVaccineSchedule.findUniqueOrThrow({ where: { id: row.id } })).status,
        ).toBe("PENDING");
        expect([await statusOf(v1), await statusOf(v2)]).toEqual(["BOUND", "BOUND"]);
    });
});
