import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { batchInHouseOn } from "@lib/batch-guards";
import { farmDay } from "@lib/farm-day";
import { houseNumber, sharedWarehouseId, seedStock, purgeAuditLog } from "@lib/test-fixtures";
import { BatchService } from "./batch.service";
import { BatchPnlService } from "./batch-pnl.service";
import { ConsumptionService } from "./consumption.service";
import { ExpenseService } from "./expense.service";
import { SaleService } from "./sale.service";
import { StockUnitService } from "./stock-unit.service";
import { updateFarmSettingsSchema } from "@validators/farm-settings.validator";

// Settlement window + stock count, server side.
// docs/superpowers/specs/2026-11-08-batch-settlement-and-stock-count-design.md

const DAY = 86_400_000;
const today = farmDay(new Date());
const daysAgo = (n: number) => new Date(today.getTime() - n * DAY);

let profileId: string;
let warehouseId: string;
let houseA: string; // occupied by `sold` until yesterday, empty today
let houseB: string; // occupied by `running`
let houseEmpty: string;
let itemId: string;
let purchaseId: string;
let lotId: string;
const unitIds: string[] = [];
const batchIds: string[] = [];
let sold: string;
let running: string;
let closed: string;

async function makeBatch(code: string, status: "RUNNING" | "SOLD" | "CLOSED", start: Date, end: Date | null, house?: string) {
    const b = await prisma.batches.create({
        data: {
            batch_code: `${code}-${crypto.randomUUID().slice(0, 8)}`,
            breed: "CLASSIC",
            status,
            starting_date: start,
            expected_selling_date: new Date(start.getTime() + 30 * DAY),
            actual_end_date: end,
            initial_chick_count: 100,
            init_chicks_avg_wt: 40,
        },
    });
    batchIds.push(b.id);
    if (house) {
        await prisma.batchHouseAllocation.create({
            data: {
                batch_id: b.id,
                to_house_id: house,
                quantity: 100,
                reason: "INITIAL",
                recorded_by_id: profileId,
                occurred_at: start,
                idempotency_key: crypto.randomUUID(),
            },
        });
        await prisma.batchHouseBalance.create({
            data: { batch_id: b.id, house_id: house, quantity: status === "RUNNING" ? 100 : 0 },
        });
    }
    return b.id;
}

describe("Batch settlement window + stock count", () => {
    beforeAll(async () => {
        profileId = (
            await prisma.profiles.create({
                data: { name: "Settlement Tester", mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`, role: "ADMIN" },
            })
        ).id;
        warehouseId = await sharedWarehouseId();
        const house = (name: string) =>
            prisma.houses.create({ data: { name, type: "GROWER", number: houseNumber() } }).then((h) => h.id);
        houseA = await house("Settle A");
        houseB = await house("Settle B");
        houseEmpty = await house("Settle Empty");

        sold = await makeBatch("SOLD", "SOLD", daysAgo(30), daysAgo(1), houseA);
        running = await makeBatch("RUN", "RUNNING", daysAgo(10), null, houseB);
        closed = await makeBatch("CLOSED", "CLOSED", daysAgo(60), daysAgo(20));

        const item = await prisma.item.create({
            data: {
                name: `Settle Med ${crypto.randomUUID()}`,
                normalized_key: `settle med ${crypto.randomUUID()}`,
                category: "MEDICINE",
                unit: "ML",
                is_unit_tracked: true,
            },
        });
        itemId = item.id;
        purchaseId = (
            await prisma.purchase.create({
                data: {
                    warehouse_id: warehouseId,
                    purchase_date: daysAgo(40),
                    total_amount: 500,
                    paid_amount: 0,
                    due_amount: 500,
                    recorded_by_id: profileId,
                },
            })
        ).id;
        lotId = (
            await prisma.purchaseItem.create({
                data: {
                    purchase_id: purchaseId,
                    item_id: itemId,
                    quantity: 500,
                    unit: "ML",
                    base_quantity: 500,
                    unit_price: 1,
                    total_price: 500,
                    unit_count: 5,
                },
            })
        ).id;
        await seedStock(itemId, warehouseId, 500);
        for (let i = 0; i < 5; i++) {
            const u = await prisma.stockUnit.create({
                data: { purchase_item_id: lotId, status: "BOUND", bound_at: new Date() },
            });
            unitIds.push(u.id);
        }
    });

    afterAll(async () => {
        await prisma.stockHouseAllocation.deleteMany({ where: { stock_unit_id: { in: unitIds } } });
        await prisma.consumption.deleteMany({ where: { item_id: itemId } });
        await prisma.stockLedger.deleteMany({ where: { item_id: itemId } });
        await prisma.stockTransfer.deleteMany({ where: { item_id: itemId } });
        await prisma.stockUnit.deleteMany({ where: { id: { in: unitIds } } });
        await prisma.purchaseItem.deleteMany({ where: { id: lotId } });
        await prisma.purchase.deleteMany({ where: { id: purchaseId } });
        await prisma.item.deleteMany({ where: { id: itemId } });
        await prisma.expense.deleteMany({ where: { batch_id: { in: batchIds } } });
        await prisma.sale.deleteMany({ where: { batch_id: { in: batchIds } } });
        await prisma.assetDepreciation.deleteMany({ where: { batch_id: { in: batchIds } } });
        await purgeAuditLog({ where: { record_id: { in: batchIds } } });
        await prisma.batchHouseAllocation.deleteMany({ where: { batch_id: { in: batchIds } } });
        await prisma.batchHouseBalance.deleteMany({ where: { batch_id: { in: batchIds } } });
        await prisma.batches.deleteMany({ where: { id: { in: batchIds } } });
        await prisma.houses.deleteMany({ where: { id: { in: [houseA, houseB, houseEmpty] } } });
        await purgeAuditLog({ where: { changed_by_id: profileId } });
        await prisma.profiles.deleteMany({ where: { id: profileId } });
    });

    describe("batchInHouseOn", () => {
        test("a running batch is in its house today", async () => {
            expect((await batchInHouseOn(prisma, houseB, today))?.id).toBe(running);
        });
        test("a batch sold yesterday is there yesterday, not today", async () => {
            expect((await batchInHouseOn(prisma, houseA, daysAgo(1)))?.id).toBe(sold);
            expect(await batchInHouseOn(prisma, houseA, today)).toBeNull();
        });
        test("an empty house, or a day before placement, has no batch", async () => {
            expect(await batchInHouseOn(prisma, houseEmpty, today)).toBeNull();
            expect(await batchInHouseOn(prisma, houseB, daysAgo(11))).toBeNull();
        });
    });

    describe("finalised batches take no new money", () => {
        test("expense on a CLOSED batch is refused, on a SOLD one accepted", async () => {
            const base = { category: "TRANSPORT", cost_type: "DIRECT" as const, amount: 100, date: new Date(), recorded_by_id: profileId };
            await expect(ExpenseService.create({ ...base, batch_id: closed })).rejects.toThrow(/finalised/);
            expect((await ExpenseService.create({ ...base, batch_id: sold }))?.batch_id).toBe(sold);
        });
        test("sale booked to a CLOSED batch is refused", async () => {
            await expect(
                SaleService.create({
                    kind: "CODED",
                    batch_id: closed,
                    sale_date: new Date(),
                    paid_amount: 0,
                    recorded_by_id: profileId,
                    items: [{ item_id: itemId, quantity: 1, unit_price: 1 }],
                }),
            ).rejects.toThrow(/finalised/);
        });
        test("consumption tagged to a CLOSED batch is refused", async () => {
            await expect(
                ConsumptionService.create({
                    house_id: houseB,
                    item_id: itemId,
                    quantity: 1,
                    unit: "ML",
                    date: new Date(),
                    batch_id: closed,
                    recorded_by_id: profileId,
                }),
            ).rejects.toThrow(/finalised/);
        });
    });

    describe("stock count", () => {
        test("every bound unit is at the lot's warehouse", async () => {
            const at = await StockUnitService.atLocation({ location_type: "WAREHOUSE", location_id: warehouseId, item_id: itemId });
            expect(at.map((u) => u.id).sort()).toEqual([...unitIds].sort());
            expect(at[0]!.item.id).toBe(itemId);
        });

        test("consumed yesterday in an emptied house: moves in, used up, cost on the sold batch", async () => {
            const id = unitIds[0]!;
            await StockUnitService.use(id, {
                action: "FINISH",
                house_id: houseA,
                date: daysAgo(1),
                move_here: true,
                recorded_by_id: profileId,
                idempotency_key: crypto.randomUUID(),
            });
            const unit = await prisma.stockUnit.findUniqueOrThrow({ where: { id } });
            expect(unit.status).toBe("CONSUMED");
            const c = await prisma.consumption.findFirstOrThrow({ where: { stock_unit_id: id } });
            expect(c.house_id).toBe(houseA);
            expect(c.batch_id).toBe(sold);
            expect(Number(c.base_quantity)).toBe(100);
            // gone from the warehouse count
            const at = await StockUnitService.atLocation({ location_type: "WAREHOUSE", location_id: warehouseId, item_id: itemId });
            expect(at.map((u) => u.id)).not.toContain(id);
        });

        test("move_here on a unit already in the house just uses it", async () => {
            const id = unitIds[1]!;
            await StockUnitService.relocate(id, houseB, crypto.randomUUID());
            expect((await StockUnitService.atLocation({ location_type: "HOUSE", location_id: houseB })).map((u) => u.id)).toContain(id);
            await StockUnitService.use(id, {
                action: "START",
                house_id: houseB,
                date: new Date(),
                move_here: true,
                recorded_by_id: profileId,
            });
            expect((await prisma.stockUnit.findUniqueOrThrow({ where: { id } })).status).toBe("IN_USE");
        });

        test("a returned unit is back on its warehouse's list; a disposed one on none", async () => {
            const back = unitIds[1]!;
            await StockUnitService.relocate(back, null, crypto.randomUUID());
            await StockUnitService.dispose(unitIds[2]!);
            const at = (await StockUnitService.atLocation({ location_type: "WAREHOUSE", location_id: warehouseId, item_id: itemId })).map((u) => u.id);
            expect(at).toContain(back);
            expect(at).not.toContain(unitIds[2]!);
        });

        test("consumed today in an empty house gets no batch", async () => {
            const id = unitIds[3]!;
            await StockUnitService.use(id, {
                action: "FINISH",
                house_id: houseEmpty,
                date: new Date(),
                move_here: true,
                recorded_by_id: profileId,
            });
            const c = await prisma.consumption.findFirstOrThrow({ where: { stock_unit_id: id } });
            expect(c.batch_id).toBeNull();
        });
    });

    describe("finalize", () => {
        test("RUNNING can't be finalised", async () => {
            await expect(BatchService.finalize(running, profileId)).rejects.toThrow(/Only a sold batch/);
        });
        test("finalizeDue closes SOLD batches past the window only", async () => {
            const old = await makeBatch("OLD", "SOLD", daysAgo(50), daysAgo(9));
            const fresh = await makeBatch("FRESH", "SOLD", daysAgo(40), daysAgo(2));
            await BatchService.finalizeDue(new Date(), 7);
            const status = async (id: string) => (await prisma.batches.findUniqueOrThrow({ where: { id } })).status;
            expect(await status(old)).toBe("CLOSED");
            expect(await status(fresh)).toBe("SOLD");
            expect(await status(running)).toBe("RUNNING");
        });
        test("after finalising, a late usage on the batch is refused", async () => {
            await BatchService.finalize(sold, profileId);
            await expect(
                StockUnitService.use(unitIds[4]!, {
                    action: "FINISH",
                    house_id: houseA,
                    date: daysAgo(1),
                    move_here: true,
                    recorded_by_id: profileId,
                }),
            ).rejects.toThrow(/finalised/);
            // all-or-nothing: the refused use didn't move the unit either
            const at = (await StockUnitService.atLocation({ location_type: "WAREHOUSE", location_id: warehouseId, item_id: itemId })).map((u) => u.id);
            expect(at).toContain(unitIds[4]!);
        });
    });

    test("litter sale booked to a batch counts as other sales in its P&L", async () => {
        await prisma.sale.create({
            data: { batch_id: running, sale_date: new Date(), total: 500, paid_amount: 0, due_amount: 500, recorded_by_id: profileId },
        });
        const s = await BatchPnlService.statement(running);
        expect(s.revenue.other_sales).toBe(500);
        expect(s.revenue.net).toBe(500);
    });

    test("settlement_days is 0-60", () => {
        expect(updateFarmSettingsSchema.safeParse({ settlement_days: 61 }).success).toBe(false);
        expect(updateFarmSettingsSchema.safeParse({ settlement_days: 10 }).data).toEqual({ settlement_days: 10 });
    });
});
