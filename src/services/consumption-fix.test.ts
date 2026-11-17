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
let profileId: string;
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

async function bottle(lot: string) {
    const [unit] = await provisionPrinted(1);
    unitIds.push(unit!.id);
    await StockUnitService.bind(unit!.id, { purchase_item_id: lot });
    await StockUnitService.relocate(unit!.id, houseId, crypto.randomUUID());
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
        houseId = (
            await prisma.houses.create({
                data: { name: "Fix House", type: "GROWER", number: houseNumber() },
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
        // 10 bottles of 100 ml each.
        const lot = (item_id: string) =>
            prisma.purchaseItem.create({
                data: {
                    purchase_id: purchaseId,
                    item_id,
                    quantity: 10,
                    unit: "BOTTLE",
                    base_quantity: 1000,
                    unit_count: 10,
                    unit_price: 1,
                    total_price: 10,
                },
            });
        medLot = (await lot(medId)).id;
        vaccineLot = (await lot(vaccineId)).id;

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
        await prisma.vaccinePurpose.create({ data: { code: PURPOSE, label: "Fix test purpose" } });
    });

    afterAll(async () => {
        const items = [feedId, medId, vaccineId];
        await prisma.vaccinations.deleteMany({ where: { batch_id: batchId } });
        await prisma.medications.deleteMany({ where: { batch_id: batchId } });
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
        await prisma.batchHouseBalance.deleteMany({ where: { batch_id: batchId } });
        await prisma.batchHouseAllocation.deleteMany({ where: { batch_id: batchId } });
        await prisma.weightRecords.deleteMany({ where: { batch_id: batchId } });
        await prisma.batches.delete({ where: { id: batchId } });
        await prisma.houses.delete({ where: { id: houseId } });
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
});
