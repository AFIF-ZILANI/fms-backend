import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { houseNumber, sharedWarehouseId } from "@lib/test-fixtures";
import { StockHouseAllocationService } from "./stock-house-allocation.service";
import { ConsumptionService } from "./consumption.service";

// A house's stock history: what was moved in, what was used. Rows go in through Prisma directly --
// the point here is the filters and the summary, not the write paths other suites cover.
describe("house stock activity", () => {
    const DAY = 86_400_000;
    let profileId: string, houseId: string, otherHouseId: string;
    let itemA: string, itemB: string, purchaseId: string;
    const unitIds: string[] = [];
    const allocIds: string[] = [];
    const consumptionIds: string[] = [];
    const lotIds: string[] = [];
    const now = Date.now();

    beforeAll(async () => {
        profileId = (
            await prisma.profiles.create({
                data: {
                    name: "Seed Admin",
                    mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                    role: "ADMIN",
                },
            })
        ).id;
        houseId = (
            await prisma.houses.create({
                data: { name: "Seed House", type: "BROODER", number: houseNumber() },
            })
        ).id;
        otherHouseId = (
            await prisma.houses.create({
                data: { name: "Other House", type: "BROODER", number: houseNumber() },
            })
        ).id;

        const mkItem = async (label: string) =>
            (
                await prisma.item.create({
                    data: {
                        name: `${label} ${crypto.randomUUID()}`,
                        normalized_key: `${label} ${crypto.randomUUID()}`.toLowerCase(),
                        category: "MEDICINE",
                        unit: "BOTTLE",
                        is_unit_tracked: true,
                    },
                })
            ).id;
        itemA = await mkItem("Item A");
        itemB = await mkItem("Item B");

        purchaseId = (
            await prisma.purchase.create({
                data: {
                    warehouse_id: await sharedWarehouseId(),
                    purchase_date: new Date(),
                    total_amount: 10,
                    paid_amount: 10,
                    due_amount: 0,
                    recorded_by_id: profileId,
                },
            })
        ).id;
        for (const item_id of [itemA, itemB]) {
            lotIds.push(
                (
                    await prisma.purchaseItem.create({
                        data: {
                            purchase_id: purchaseId,
                            item_id,
                            quantity: 5,
                            unit: "BOTTLE",
                            base_quantity: 5,
                            unit_price: 1,
                            total_price: 5,
                        },
                    })
                ).id,
            );
        }
    });

    afterAll(async () => {
        await prisma.consumption.deleteMany({ where: { id: { in: consumptionIds } } });
        await prisma.stockHouseAllocation.deleteMany({ where: { id: { in: allocIds } } });
        await prisma.stockUnit.deleteMany({ where: { id: { in: unitIds } } });
        await prisma.purchaseItem.deleteMany({ where: { id: { in: lotIds } } });
        await prisma.purchase.delete({ where: { id: purchaseId } });
        await prisma.item.deleteMany({ where: { id: { in: [itemA, itemB] } } });
        await prisma.houses.deleteMany({ where: { id: { in: [houseId, otherHouseId] } } });
        await prisma.profiles.delete({ where: { id: profileId } });
    });

    const allocate = async (lot: string, house: string, ageMs: number) => {
        const unit = await prisma.stockUnit.create({
            data: { purchase_item_id: lot, status: "IN_STOCK" },
        });
        unitIds.push(unit.id);
        const row = await prisma.stockHouseAllocation.create({
            data: {
                stock_unit_id: unit.id,
                house_id: house,
                type: "ALLOCATION",
                occurred_at: new Date(now - ageMs),
                idempotency_key: crypto.randomUUID(),
            },
        });
        allocIds.push(row.id);
    };

    const use = async (item_id: string, ageMs: number) => {
        const row = await prisma.consumption.create({
            data: {
                house_id: houseId,
                item_id,
                quantity: 1,
                unit: "BOTTLE",
                base_quantity: 1,
                date: new Date(now - ageMs),
                recorded_by_id: profileId,
                idempotency_key: crypto.randomUUID(),
            },
        });
        consumptionIds.push(row.id);
    };

    const windows = {
        house_id: "",
        today_from: new Date(now - 6 * 3600_000),
        week_from: new Date(now - 7 * DAY),
    };

    test("allocation summary counts this house only, by window, with distinct items and the latest", async () => {
        await allocate(lotIds[0]!, houseId, 3600_000); //          1 h ago, item A  (today)
        await allocate(lotIds[0]!, houseId, 2 * DAY); //            2 days ago, item A (this week)
        await allocate(lotIds[1]!, houseId, 20 * DAY); //           20 days ago, item B
        await allocate(lotIds[1]!, otherHouseId, 3600_000); //      another house: must not count

        const s = await StockHouseAllocationService.summary({ ...windows, house_id: houseId });
        expect(s).toMatchObject({ total: 3, today: 1, week: 2, items: 2 });
        expect(s.last_at!.getTime()).toBe(now - 3600_000);
    });

    test("allocation list filters by item and by date", async () => {
        const base = { page: 1, limit: 100, house_id: houseId };
        const byItem = await StockHouseAllocationService.getAll({ ...base, item_id: itemB });
        expect(byItem.entries.length).toBe(1);

        const recent = await StockHouseAllocationService.getAll({
            ...base,
            occurred_from: windows.week_from,
        });
        expect(recent.entries.length).toBe(2);
    });

    test("consumption summary counts this house, by window, with distinct items and the latest", async () => {
        await use(itemA, 3600_000);
        await use(itemA, 3 * DAY);
        await use(itemB, 25 * DAY);

        const s = await ConsumptionService.summary({ ...windows, house_id: houseId });
        expect(s).toMatchObject({ total: 3, today: 1, week: 2, items: 2 });
        expect(s.last_at!.getTime()).toBe(now - 3600_000);
    });

    test("consumption list carries who recorded it", async () => {
        const { consumptions } = await ConsumptionService.getAll({
            page: 1,
            limit: 100,
            house_id: houseId,
        });
        expect(consumptions[0]!.recorded_by.name).toBe("Seed Admin");
    });

    test("a house with nothing reports zeros and no last time", async () => {
        const empty = await prisma.houses.create({
            data: { name: "Empty", type: "BROODER", number: houseNumber() },
        });
        try {
            const q = { ...windows, house_id: empty.id };
            expect(await StockHouseAllocationService.summary(q)).toEqual({
                total: 0,
                today: 0,
                week: 0,
                items: 0,
                last_at: null,
            });
            expect(await ConsumptionService.summary(q)).toEqual({
                total: 0,
                today: 0,
                week: 0,
                items: 0,
                last_at: null,
            });
        } finally {
            await prisma.houses.delete({ where: { id: empty.id } });
        }
    });
});
