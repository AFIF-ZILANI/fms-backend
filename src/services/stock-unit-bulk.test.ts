import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { farmDay, setDayStartHour, getDayStartHour } from "@lib/farm-day";
import { houseNumber, sharedWarehouseId, seedStock, purgeAuditLog } from "@lib/test-fixtures";
import { bulkStockUnitActionSchema, BULK_MAX_UNITS } from "@validators/stock-unit.validator";
import { Hono } from "hono";
import { AppError } from "@lib/app-error";
import { sendError } from "@lib/response";
import { stockUnitRoutes } from "@routes/stock-unit.routes";
import { StockUnitService, type BulkUnitResult } from "./stock-unit.service";

// Stock count: one action for many missing units in one call (StockUnitService.bulk, POST /stock-units/bulk).

const DAY = 86_400_000;
const today = farmDay(new Date());

let profileId: string;
let warehouseId: string;
let house: string; // runs a batch, open
let closedHouse: string; // its batch is finalised
let itemId: string;
let purchaseId: string;
let lotId: string;
let batchId: string;
let closedBatchId: string;
const houseIds: string[] = [];
const unitIds: string[] = [];

const mobile = () => `+880${Math.floor(1e9 + Math.random() * 8e9)}`;
const newUnits = async (n: number) => {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
        const u = await prisma.stockUnit.create({ data: { purchase_item_id: lotId, status: "BOUND", bound_at: new Date() } });
        ids.push(u.id);
        unitIds.push(u.id);
    }
    return ids;
};
const status = async (id: string) => (await prisma.stockUnit.findUniqueOrThrow({ where: { id } })).status;
const at = async (type: "WAREHOUSE" | "HOUSE", id: string) =>
    (await StockUnitService.atLocation({ location_type: type, location_id: id, item_id: itemId })).map((u) => u.id);
const base = (units: string[]) => ({ units: units.map((id) => ({ id })), recorded_by_id: profileId });
const oks = (r: BulkUnitResult[]) => r.map((x) => x.ok);

async function makeHouseWithBatch(name: string, batchStatus: "RUNNING" | "CLOSED") {
    const h = (await prisma.houses.create({ data: { name, type: "GROWER", number: houseNumber() } })).id;
    houseIds.push(h);
    const start = new Date(today.getTime() - 10 * DAY);
    const b = await prisma.batches.create({
        data: {
            batch_code: `BK-${crypto.randomUUID().slice(0, 8)}`,
            breed: "CLASSIC",
            status: batchStatus,
            starting_date: start,
            expected_selling_date: new Date(start.getTime() + 30 * DAY),
            actual_end_date: batchStatus === "CLOSED" ? new Date(today.getTime() + DAY) : null,
            initial_chick_count: 100,
        },
    });
    await prisma.batchHouseAllocation.create({
        data: { batch_id: b.id, to_house_id: h, quantity: 100, reason: "INITIAL", recorded_by_id: profileId, occurred_at: start, idempotency_key: crypto.randomUUID() },
    });
    await prisma.batchHouseBalance.create({ data: { batch_id: b.id, house_id: h, quantity: 100 } });
    return { house: h, batch: b.id };
}

describe("Stock count: bulk actions", () => {
    beforeAll(async () => {
        profileId = (await prisma.profiles.create({ data: { name: "Bulk Tester", mobile: mobile(), role: "ADMIN" } })).id;
        await prisma.admins.create({ data: { profile_id: profileId } });
        warehouseId = await sharedWarehouseId();
        ({ house, batch: batchId } = await makeHouseWithBatch("Bulk H", "RUNNING"));
        ({ house: closedHouse, batch: closedBatchId } = await makeHouseWithBatch("Bulk Closed H", "CLOSED"));
        itemId = (
            await prisma.item.create({
                data: { name: `Bulk Med ${crypto.randomUUID()}`, normalized_key: `bulk med ${crypto.randomUUID()}`, category: "MEDICINE", unit: "ML", is_unit_tracked: true },
            })
        ).id;
        purchaseId = (
            await prisma.purchase.create({
                data: { warehouse_id: warehouseId, purchase_date: new Date(today.getTime() - 40 * DAY), total_amount: 2000, paid_amount: 0, due_amount: 2000, recorded_by_id: profileId },
            })
        ).id;
        lotId = (
            await prisma.purchaseItem.create({
                data: { purchase_id: purchaseId, item_id: itemId, quantity: 2000, unit: "ML", base_quantity: 2000, unit_price: 1, total_price: 2000, unit_count: 20 },
            })
        ).id;
        await seedStock(itemId, warehouseId, 2000);
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
        const batches = [batchId, closedBatchId];
        await prisma.batchHouseAllocation.deleteMany({ where: { batch_id: { in: batches } } });
        await prisma.batchHouseBalance.deleteMany({ where: { batch_id: { in: batches } } });
        await prisma.weightRecords.deleteMany({ where: { batch_id: { in: batches } } });
        await prisma.batches.deleteMany({ where: { id: { in: batches } } });
        await prisma.houses.deleteMany({ where: { id: { in: houseIds } } });
        await purgeAuditLog({ where: { changed_by_id: profileId } });
        await prisma.admins.deleteMany({ where: { profile_id: profileId } });
        await prisma.profiles.deleteMany({ where: { id: profileId } });
    });

    test("used up: every unit moves in and is charged to the house's batch on the day asked", async () => {
        const ids = await newUnits(4);
        const date = new Date(Date.now() - DAY); // "Yesterday": the real instant, one day back
        const r = await StockUnitService.bulk({ action: "FINISH", house_id: house, date, ...base(ids) });
        expect(oks(r)).toEqual([true, true, true, true]);
        for (const id of ids) expect(await status(id)).toBe("CONSUMED");
        const rows = await prisma.consumption.findMany({ where: { stock_unit_id: { in: ids } } });
        expect(rows).toHaveLength(4);
        for (const c of rows) {
            expect(c.house_id).toBe(house);
            expect(c.batch_id).toBe(batchId);
            expect(Number(c.base_quantity)).toBe(100); // 2000 ml / 20 bottles
            expect(c.date.getTime()).toBe(date.getTime()); // the instant is kept as sent, not flattened to a day
        }
        const warehouse = await at("WAREHOUSE", warehouseId);
        for (const id of ids) expect(warehouse).not.toContain(id);
    });

    test("one refused unit doesn't undo the rest, and says why in the words a single call would", async () => {
        const [a, b, c] = await newUnits(3);
        await StockUnitService.dispose(b!); // already gone
        const r = await StockUnitService.bulk({ action: "FINISH", house_id: house, date: new Date(), ...base([a!, b!, c!]) });
        expect(oks(r)).toEqual([true, false, true]);
        expect(r[1]).toMatchObject({ id: b, ok: false, status: 409 });
        expect(await status(a!)).toBe("CONSUMED");
        expect(await status(c!)).toBe("CONSUMED");
        expect(await status(b!)).toBe("DISPOSED");
    });

    test("a finalised batch refuses the used-up units and nothing moves", async () => {
        const ids = await newUnits(2);
        const r = await StockUnitService.bulk({ action: "FINISH", house_id: closedHouse, date: new Date(), ...base(ids) });
        expect(oks(r)).toEqual([false, false]);
        for (const x of r) expect(x).toMatchObject({ ok: false, status: 409 });
        expect(r[0]).toHaveProperty("message", expect.stringMatching(/finalised/));
        expect(await at("WAREHOUSE", warehouseId)).toEqual(expect.arrayContaining(ids)); // all-or-nothing per unit
    });

    test("start using, move, return and dispose each work on a list", async () => {
        const [s1, s2, m1, m2, d1, d2] = await newUnits(6);
        let r = await StockUnitService.bulk({ action: "START", house_id: house, ...base([s1!, s2!]) });
        expect(oks(r)).toEqual([true, true]);
        expect(await status(s1!)).toBe("IN_USE");
        expect(await at("HOUSE", house)).toEqual(expect.arrayContaining([s1!, s2!])); // moved in first

        r = await StockUnitService.bulk({ action: "MOVE", house_id: house, ...base([m1!, m2!]) });
        expect(oks(r)).toEqual([true, true]);
        expect(await at("HOUSE", house)).toEqual(expect.arrayContaining([m1!, m2!]));

        r = await StockUnitService.bulk({ action: "RETURN", ...base([m1!, m2!]) });
        expect(oks(r)).toEqual([true, true]);
        expect(await at("WAREHOUSE", warehouseId)).toEqual(expect.arrayContaining([m1!, m2!]));

        r = await StockUnitService.bulk({ action: "DISPOSE", ...base([d1!, d2!]) });
        expect(oks(r)).toEqual([true, true]);
        expect(await status(d1!)).toBe("DISPOSED");
    });

    test("retrying a landed call answers with the exact 409 words the phone treats as done", async () => {
        const ids = await newUnits(1);
        // As the phone does: a key per (unit, action), kept across retries of that action.
        const keys: Record<string, string> = {};
        const call = (action: "FINISH" | "START" | "MOVE" | "RETURN" | "DISPOSE", extra: object = {}) =>
            StockUnitService.bulk({
                action,
                units: [{ id: ids[0]!, idempotency_key: (keys[action] ??= crypto.randomUUID()) }],
                recorded_by_id: profileId,
                ...extra,
            });
        const msg = (r: BulkUnitResult[]) => (r[0]!.ok ? "" : r[0]!.message);

        // mobile/src/lib/stock-count.ts alreadyDone(): these patterns must keep matching.
        await call("MOVE", { house_id: house });
        expect(msg(await call("MOVE", { house_id: house }))).toMatch(/already at that house/);
        await call("RETURN");
        expect(msg(await call("RETURN"))).toMatch(/already at the warehouse/);
        await call("START", { house_id: house });
        expect(msg(await call("START", { house_id: house }))).toMatch(/already in use/);
        await call("FINISH", { house_id: house, date: new Date() });
        expect(msg(await call("FINISH", { house_id: house, date: new Date() }))).toMatch(/is consumed/);
        await call("DISPOSE");
        expect(msg(await call("DISPOSE"))).toMatch(/already disposed/);
    });

    test("the request is checked before anything runs", () => {
        const id = crypto.randomUUID();
        const ok = (v: object) => bulkStockUnitActionSchema.safeParse(v).success;
        const units = [{ id }];
        expect(ok({ action: "FINISH", house_id: crypto.randomUUID(), date: new Date().toISOString(), units })).toBe(true);
        expect(ok({ action: "FINISH", house_id: crypto.randomUUID(), units })).toBe(false); // no date
        expect(ok({ action: "MOVE", units })).toBe(false); // no house
        expect(ok({ action: "RETURN", units })).toBe(true);
        expect(ok({ action: "DISPOSE", units })).toBe(true);
        expect(ok({ action: "DISPOSE", units: [] })).toBe(false);
        const many = Array.from({ length: BULK_MAX_UNITS + 1 }, () => ({ id: crypto.randomUUID() }));
        expect(ok({ action: "DISPOSE", units: many })).toBe(false);
    });

    test("over HTTP: one call fixes the lot and answers per unit; a bad body is a 400", async () => {
        // The route module on its own, signed in as the test admin: the app-wide rate limiter is one bucket
        // shared by every test file in a run, and who may call it is pinned in permissions.test.ts.
        const api = new Hono<{ Variables: { auth: { profile_id: string } } }>();
        api.onError((err, c) => (err instanceof AppError ? sendError(c, err) : c.text("unexpected", 500)));
        api.use("*", async (c, next) => {
            c.set("auth", { profile_id: profileId });
            await next();
        });
        api.route("/stock-units", stockUnitRoutes);
        const post = (body: unknown) =>
            api.request("/stock-units/bulk", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });

        const ids = await newUnits(3);
        const res = await post({ action: "FINISH", house_id: house, date: new Date().toISOString(), units: ids.map((id) => ({ id, idempotency_key: crypto.randomUUID() })) });
        expect(res.status).toBe(200);
        const { data } = (await res.json()) as { data: { results: BulkUnitResult[] } };
        expect(data.results.map((x) => x.id)).toEqual(ids);
        expect(oks(data.results)).toEqual([true, true, true]);
        for (const id of ids) expect(await status(id)).toBe("CONSUMED");

        expect((await post({ action: "FINISH", house_id: house, units: ids.map((id) => ({ id })) })).status).toBe(400); // no date
    });
});

// The same instants are pinned in mobile/src/lib/stock-count.test.ts (farmDateParam): the sheet's "Today /
// Yesterday" preview and the day the server files the use under must never disagree.
describe("Farm day of an instant (shared with the phone)", () => {
    const keep = getDayStartHour();
    afterAll(() => setDayStartHour(keep));
    const day = (iso: string) => farmDay(new Date(iso)).toISOString().slice(0, 10);

    test("day starts at midnight", () => {
        setDayStartHour(0);
        expect(day("2026-11-08T17:59:00Z")).toBe("2026-11-08"); // 23:59 Dhaka
        expect(day("2026-11-08T18:05:00Z")).toBe("2026-11-09"); // 00:05 Dhaka -> the new day
    });
    test("day starts at 04:00: the small hours belong to the day before", () => {
        setDayStartHour(4);
        expect(day("2026-11-08T19:30:00Z")).toBe("2026-11-08"); // 01:30 Dhaka on the 9th
        expect(day("2026-11-08T22:30:00Z")).toBe("2026-11-09"); // 04:30 Dhaka on the 9th
        // "Yesterday" is the same instant 24h back: always exactly one farm day earlier
        expect(day(new Date(Date.parse("2026-11-08T19:30:00Z") - DAY).toISOString())).toBe("2026-11-07");
    });
});
