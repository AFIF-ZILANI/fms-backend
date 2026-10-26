import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { StockUnitService } from "./stock-unit.service";
import { PurchaseItemService } from "./purchase.service";
import { AppError } from "@lib/app-error";
import { houseNumber, sharedWarehouseId, provisionPrinted } from "@lib/test-fixtures";

const createdUnitIds: string[] = [];
const createdTransferIds: string[] = [];
let purchaseItemId: string;
let houseId: string;
let profileId: string;
let itemId: string;
let purchaseId: string;
let equipmentPurchaseId: string;
let equipmentPurchaseItemId: string;
let equipmentItemId: string;

describe("StockUnitService", () => {
    // Purchases (Phase 7) doesn't exist yet -- seed the PurchaseItem this
    // module's bind() action needs directly via Prisma, bypassing the
    // not-yet-built Purchases API. Legitimate test-fixture pattern for an
    // out-of-phase-order dependency, not a shortcut around real behavior.
    /** A provisioned code bound to the shared lot -- relocating needs a bound unit. */
    async function boundUnit() {
        const [unit] = await provisionPrinted(1);
        createdUnitIds.push(unit!.id);
        return StockUnitService.bind(unit!.id, { purchase_item_id: purchaseItemId });
    }

    beforeAll(async () => {
        const profile = await prisma.profiles.create({
            data: {
                name: "Seed Admin",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "ADMIN",
            },
        });
        profileId = profile.id;

        const item = await prisma.item.create({
            data: {
                name: `Seed Medicine ${crypto.randomUUID()}`,
                normalized_key: `seed medicine ${crypto.randomUUID()}`,
                category: "MEDICINE",
                unit: "BOTTLE",
                is_unit_tracked: true,
            },
        });
        itemId = item.id;

        const purchase = await prisma.purchase.create({
            data: {
                warehouse_id: await sharedWarehouseId(),
                purchase_date: new Date(),
                total_amount: 100,
                paid_amount: 100,
                due_amount: 0,
                recorded_by_id: profile.id,
            },
        });
        purchaseId = purchase.id;

        const purchaseItem = await prisma.purchaseItem.create({
            data: {
                purchase_id: purchase.id,
                item_id: item.id,
                quantity: 10,
                unit: "BOTTLE",
                base_quantity: 10,
                unit_price: 10,
                total_price: 100,
            },
        });
        purchaseItemId = purchaseItem.id;

        const house = await prisma.houses.create({
            data: { name: "Seed House", type: "BROODER", number: houseNumber() },
        });
        houseId = house.id;
    });

    afterAll(async () => {
        // FINISH ("used up") logs a Consumption against the unit
        await prisma.consumption.deleteMany({ where: { stock_unit_id: { in: createdUnitIds } } });
        await prisma.stockHouseAllocation.deleteMany({
            where: { stock_unit_id: { in: createdUnitIds } },
        });
        await prisma.stockUnit.deleteMany({ where: { id: { in: createdUnitIds } } });
        await prisma.stockTransfer.deleteMany({ where: { id: { in: createdTransferIds } } });
        // write-offs from CONSUMED/DISPOSED units
        await prisma.stockLedger.deleteMany({ where: { item_id: itemId } });
        await prisma.purchaseItem.deleteMany({ where: { purchase_id: purchaseId } });
        await prisma.purchase.delete({ where: { id: purchaseId } });
        await prisma.item.delete({ where: { id: itemId } });
        await prisma.purchaseItem.delete({ where: { id: equipmentPurchaseItemId } });
        await prisma.purchase.delete({ where: { id: equipmentPurchaseId } });
        await prisma.item.delete({ where: { id: equipmentItemId } });
        await prisma.houses.delete({ where: { id: houseId } });
        await prisma.profiles.delete({ where: { id: profileId } });
    });

    test("provision creates N unassigned units with unique ids", async () => {
        const units = await StockUnitService.provision(3);
        createdUnitIds.push(...units.map((u) => u.id));

        expect(units.length).toBe(3);
        expect(units.every((u) => u.status === "UNASSIGNED")).toBe(true);
        expect(new Set(units.map((u) => u.id)).size).toBe(3);
    });

    test("bind transitions PRINTED -> BOUND", async () => {
        const [unit] = await provisionPrinted(1);
        createdUnitIds.push(unit!.id);

        const bound = await StockUnitService.bind(unit!.id, {
            purchase_item_id: purchaseItemId,
        });
        expect(bound.status).toBe("BOUND");
        expect(bound.purchase_item_id).toBe(purchaseItemId);
        expect(bound.bound_at).not.toBeNull();
    });

    test("markPrinted flips only UNASSIGNED units; bind refuses an unprinted code", async () => {
        const [blank] = await StockUnitService.provision(1);
        createdUnitIds.push(blank!.id);
        await expect(
            StockUnitService.bind(blank!.id, { purchase_item_id: purchaseItemId }),
        ).rejects.toMatchObject({ status: 409 });

        const bound = await boundUnit();
        expect(await StockUnitService.markPrinted([blank!.id, bound.id])).toEqual({ updated: 1 });
        expect((await prisma.stockUnit.findUniqueOrThrow({ where: { id: bound.id } })).status).toBe(
            "BOUND",
        );
        const printed = await StockUnitService.bind(blank!.id, {
            purchase_item_id: purchaseItemId,
        });
        expect(printed.status).toBe("BOUND");
        await expect(StockUnitService.setStatus(bound.id, "PRINTED")).rejects.toMatchObject({
            status: 400,
        });
    });

    test("use START opens a unit with no consumption; FINISH logs what was left and marks it used up", async () => {
        const unit = await boundUnit();
        const at = { house_id: houseId, date: new Date(), recorded_by_id: profileId };
        // Not in the house yet: a unit is used where it physically is.
        await expect(
            StockUnitService.use(unit.id, { ...at, action: "START" }),
        ).rejects.toMatchObject({
            status: 409,
        });
        await StockUnitService.relocate(unit.id, houseId, crypto.randomUUID());

        expect((await StockUnitService.use(unit.id, { ...at, action: "START" })).status).toBe(
            "IN_USE",
        );
        expect(await prisma.consumption.count({ where: { stock_unit_id: unit.id } })).toBe(0);
        // Starting twice is refused; finishing an opened unit is the normal path.
        await expect(
            StockUnitService.use(unit.id, { ...at, action: "START" }),
        ).rejects.toMatchObject({
            status: 409,
        });

        const done = await StockUnitService.use(unit.id, { ...at, action: "FINISH" });
        expect(done.status).toBe("CONSUMED");
        const logged = await prisma.consumption.findMany({ where: { stock_unit_id: unit.id } });
        expect(logged).toHaveLength(1);
        expect(logged[0]!.base_quantity.greaterThan(0)).toBe(true);
        const out = await prisma.stockLedger.findFirstOrThrow({ where: { ref_id: logged[0]!.id } });
        expect(out.quantity.equals(logged[0]!.base_quantity)).toBe(true);
        await expect(
            StockUnitService.use(unit.id, { ...at, action: "FINISH" }),
        ).rejects.toMatchObject({
            status: 409,
        });

        // A never-opened unit can be finished straight away too.
        const sealed = await boundUnit();
        await StockUnitService.relocate(sealed.id, houseId, crypto.randomUUID());
        expect((await StockUnitService.use(sealed.id, { ...at, action: "FINISH" })).status).toBe(
            "CONSUMED",
        );
        expect(await prisma.consumption.count({ where: { stock_unit_id: sealed.id } })).toBe(1);
    });

    test("binding to a nonexistent purchase_item_id throws bad-request, not a raw 500", async () => {
        const [unit] = await provisionPrinted(1);
        createdUnitIds.push(unit!.id);

        await expect(
            StockUnitService.bind(unit!.id, {
                purchase_item_id: "00000000-0000-0000-0000-000000000000",
            }),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("binding an already-bound unit throws a conflict", async () => {
        const [unit] = await provisionPrinted(1);
        createdUnitIds.push(unit!.id);
        await StockUnitService.bind(unit!.id, { purchase_item_id: purchaseItemId });

        await expect(
            StockUnitService.bind(unit!.id, { purchase_item_id: purchaseItemId }),
        ).rejects.toMatchObject({ status: 409 });
    });

    test("the first bind fixes the lot's unit_count and the next bind past it is refused", async () => {
        const lot = await prisma.purchaseItem.create({
            data: {
                purchase_id: purchaseId,
                item_id: itemId,
                quantity: 2,
                unit: "BOTTLE",
                base_quantity: 2,
                unit_price: 10,
                total_price: 20,
            },
        });
        const units = await provisionPrinted(3);
        createdUnitIds.push(...units.map((u) => u.id));

        await StockUnitService.bind(units[0]!.id, { purchase_item_id: lot.id, unit_count: 2 });
        expect((await prisma.purchaseItem.findUnique({ where: { id: lot.id } }))?.unit_count).toBe(
            2,
        );

        // a different split once fixed is refused, and so is omitting it being harmless
        await expect(
            StockUnitService.bind(units[1]!.id, { purchase_item_id: lot.id, unit_count: 5 }),
        ).rejects.toMatchObject({ status: 409 });
        await StockUnitService.bind(units[1]!.id, { purchase_item_id: lot.id });

        await expect(
            StockUnitService.bind(units[2]!.id, { purchase_item_id: lot.id }),
        ).rejects.toMatchObject({ status: 409 });
    });

    test("complete needs every stated unit linked, and only applies to a lot with no bottle count", async () => {
        const lot = await prisma.purchaseItem.create({
            data: {
                purchase_id: purchaseId,
                item_id: itemId,
                quantity: 5,
                unit: "BOTTLE",
                base_quantity: 5,
                unit_price: 10,
                total_price: 50,
            },
        });
        const units = await provisionPrinted(3);
        createdUnitIds.push(...units.map((u) => u.id));
        await StockUnitService.bind(units[0]!.id, { purchase_item_id: lot.id });
        await StockUnitService.bind(units[1]!.id, { purchase_item_id: lot.id });

        // 2 linked of 3 stated: refused, and nothing is saved
        await expect(PurchaseItemService.complete(lot.id, 3)).rejects.toMatchObject({
            status: 400,
        });
        expect(
            (await prisma.purchaseItem.findUnique({ where: { id: lot.id } }))?.unit_count,
        ).toBeNull();

        const done = await PurchaseItemService.complete(lot.id, 2);
        expect(done.unit_count).toBe(2);

        await expect(
            StockUnitService.bind(units[2]!.id, { purchase_item_id: lot.id }),
        ).rejects.toMatchObject({ status: 409 });
        // already has a count -- a split lot completes by itself, there is nothing to mark
        await expect(PurchaseItemService.complete(lot.id, 2)).rejects.toMatchObject({
            status: 409,
        });
    });

    test("purchase-items reports when a line was last linked and how many since a given time", async () => {
        const lot = await prisma.purchaseItem.create({
            data: {
                purchase_id: purchaseId,
                item_id: itemId,
                quantity: 3,
                unit: "BOTTLE",
                base_quantity: 3,
                unit_price: 10,
                total_price: 30,
            },
        });
        const units = await provisionPrinted(2);
        createdUnitIds.push(...units.map((u) => u.id));
        const before = new Date();
        await StockUnitService.bind(units[0]!.id, { purchase_item_id: lot.id });
        await StockUnitService.bind(units[1]!.id, { purchase_item_id: lot.id });

        const { purchaseItems } = await PurchaseItemService.getAll({
            page: 1,
            limit: 100,
            item_id: itemId,
            since: before,
        });
        const row = purchaseItems.find((p) => p.id === lot.id)!;
        expect(row.linked_since).toBe(2);
        expect(row.last_linked_at!.getTime()).toBeGreaterThanOrEqual(before.getTime());

        // a line nothing was linked to reports none, rather than throwing on the missing group
        const empty = purchaseItems.find((p) => p.id === purchaseItemId)!;
        expect(empty.linked_since).toBe(0);
    });

    test("binding a lot whose item isn't unit-tracked is rejected", async () => {
        const untrackedItem = await prisma.item.create({
            data: {
                name: `Untracked Feed ${crypto.randomUUID()}`,
                normalized_key: `untracked feed ${crypto.randomUUID()}`,
                category: "FEED",
                unit: "KG",
                // is_unit_tracked defaults false
            },
        });
        const untrackedPurchase = await prisma.purchase.create({
            data: {
                warehouse_id: await sharedWarehouseId(),
                purchase_date: new Date(),
                total_amount: 10,
                paid_amount: 10,
                due_amount: 0,
                recorded_by_id: profileId,
            },
        });
        const untrackedPurchaseItem = await prisma.purchaseItem.create({
            data: {
                purchase_id: untrackedPurchase.id,
                item_id: untrackedItem.id,
                quantity: 10,
                unit: "KG",
                base_quantity: 10,
                unit_price: 1,
                total_price: 10,
            },
        });

        const [unit] = await provisionPrinted(1);
        createdUnitIds.push(unit!.id);
        await expect(
            StockUnitService.bind(unit!.id, { purchase_item_id: untrackedPurchaseItem.id }),
        ).rejects.toMatchObject({ status: 400 });

        await prisma.purchaseItem.delete({ where: { id: untrackedPurchaseItem.id } });
        await prisma.purchase.delete({ where: { id: untrackedPurchase.id } });
        await prisma.item.delete({ where: { id: untrackedItem.id } });
    });

    test("relocate logs a house allocation", async () => {
        const unit = await boundUnit();
        createdUnitIds.push(unit!.id);

        const relocated = await StockUnitService.relocate(unit!.id, houseId, crypto.randomUUID());
        expect(relocated.house_id).toBe(houseId);
        expect(relocated.stock_unit_id).toBe(unit!.id);
    });

    test("ten relocations of one unit to the same house racing: one lands, the rest are conflicts", async () => {
        const unit = await boundUnit();
        createdUnitIds.push(unit!.id);

        const move = () => StockUnitService.relocate(unit!.id, houseId, crypto.randomUUID());
        const results = await Promise.allSettled(Array.from({ length: 10 }, move));

        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        for (const r of results) {
            if (r.status === "rejected") expect(r.reason).toMatchObject({ status: 409 });
        }
        expect(
            await prisma.stockHouseAllocation.count({ where: { stock_unit_id: unit!.id } }),
        ).toBe(1);
    });

    test("relocate waits for the unit's lock, so a racing move reads the real current house", async () => {
        const unit = await boundUnit();
        createdUnitIds.push(unit!.id);

        // Another writer holds this unit's lock for a moment.
        let released = false;
        const holder = prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${unit!.id}, 0))`;
            await Bun.sleep(300);
            released = true;
        });
        await Bun.sleep(60); // let the holder take it

        await StockUnitService.relocate(unit!.id, houseId, crypto.randomUUID());
        // Without the lock relocate returns at once, long before the holder lets go.
        expect(released).toBe(true);
        await holder;
    });

    test("relocate moves the unit's stock in the ledger: warehouse -> house, and back on return", async () => {
        const unit = await boundUnit();
        const legs = async (transferId: string | null) =>
            prisma.stockLedger.findMany({
                where: { ref_type: "TRANSFER", ref_id: transferId ?? "" },
                orderBy: { direction: "asc" },
            });

        const moved = await StockUnitService.relocate(unit.id, houseId, crypto.randomUUID());
        const [inLeg, outLeg] = await legs(moved!.stock_transfer_id);
        expect(outLeg).toMatchObject({ direction: "OUT", location_type: "WAREHOUSE" });
        expect(inLeg).toMatchObject({
            direction: "IN",
            location_type: "HOUSE",
            location_id: houseId,
        });
        expect(inLeg!.quantity.toNumber()).toBeGreaterThan(0);
        expect(inLeg!.quantity.toNumber()).toBe(outLeg!.quantity.toNumber());

        const back = await StockUnitService.relocate(unit.id, null, crypto.randomUUID());
        const [backIn, backOut] = await legs(back!.stock_transfer_id);
        expect(backOut).toMatchObject({ location_type: "HOUSE", location_id: houseId });
        expect(backIn).toMatchObject({
            location_type: "WAREHOUSE",
            location_id: outLeg!.location_id,
        });
    }, 20_000);

    test("relocate infers ALLOCATION on first move, REALLOCATION on a house->house move, RETURN to warehouse", async () => {
        const unit = await boundUnit();
        createdUnitIds.push(unit!.id);
        const houseTwo = await prisma.houses.create({
            data: { name: "Seed House Two", type: "BROODER", number: houseNumber() },
        });

        const allocated = await StockUnitService.relocate(unit!.id, houseId, crypto.randomUUID());
        expect(allocated.type).toBe("ALLOCATION");

        const reallocated = await StockUnitService.relocate(
            unit!.id,
            houseTwo.id,
            crypto.randomUUID(),
        );
        expect(reallocated.type).toBe("REALLOCATION");
        expect(reallocated.house_id).toBe(houseTwo.id);

        const returned = await StockUnitService.relocate(unit!.id, null, crypto.randomUUID());
        expect(returned.type).toBe("RETURN");
        expect(returned.house_id).toBeNull();

        const reAllocated = await StockUnitService.relocate(unit!.id, houseId, crypto.randomUUID());
        expect(reAllocated.type).toBe("ALLOCATION");

        // The allocations that point at this house go first: a house with history can't be deleted.
        await prisma.stockHouseAllocation.deleteMany({ where: { house_id: houseTwo.id } });
        await prisma.houses.delete({ where: { id: houseTwo.id } });
    }, 20_000);

    test("relocate rejects a no-op move (same house, or already at the warehouse)", async () => {
        const unit = await boundUnit();
        createdUnitIds.push(unit!.id);

        await expect(
            StockUnitService.relocate(unit!.id, null, crypto.randomUUID()),
        ).rejects.toMatchObject({
            status: 409,
        });

        await StockUnitService.relocate(unit!.id, houseId, crypto.randomUUID());
        await expect(
            StockUnitService.relocate(unit!.id, houseId, crypto.randomUUID()),
        ).rejects.toMatchObject({ status: 409 });
    });

    test("relocate with a stock_transfer_id for the unit's own item stores it on the allocation row", async () => {
        const [unit] = await provisionPrinted(1);
        createdUnitIds.push(unit!.id);
        await StockUnitService.bind(unit!.id, { purchase_item_id: purchaseItemId });

        const transfer = await prisma.stockTransfer.create({
            data: {
                item_id: itemId,
                from_location_type: "WAREHOUSE",
                from_location_id: crypto.randomUUID(),
                to_location_type: "HOUSE",
                to_location_id: houseId,
                quantity: 10,
                unit: "BOTTLE",
                base_quantity: 10,
                recorded_by_id: profileId,
                idempotency_key: crypto.randomUUID(),
            },
        });
        createdTransferIds.push(transfer.id);

        const relocated = await StockUnitService.relocate(
            unit!.id,
            houseId,
            crypto.randomUUID(),
            transfer.id,
        );
        expect(relocated.stock_transfer_id).toBe(transfer.id);
    });

    test("relocate rejects a stock_transfer_id for a nonexistent transfer with a 404", async () => {
        const [unit] = await provisionPrinted(1);
        createdUnitIds.push(unit!.id);
        await StockUnitService.bind(unit!.id, { purchase_item_id: purchaseItemId });

        await expect(
            StockUnitService.relocate(
                unit!.id,
                houseId,
                crypto.randomUUID(),
                "00000000-0000-0000-0000-000000000000",
            ),
        ).rejects.toMatchObject({ status: 404 });
    });

    test("relocate rejects a stock_transfer_id for a different item with a 400", async () => {
        const [unit] = await provisionPrinted(1);
        createdUnitIds.push(unit!.id);
        await StockUnitService.bind(unit!.id, { purchase_item_id: purchaseItemId });

        const otherItem = await prisma.item.create({
            data: {
                name: `Other Item ${crypto.randomUUID()}`,
                normalized_key: `other item ${crypto.randomUUID()}`,
                category: "MEDICINE",
                unit: "BOTTLE",
            },
        });
        const transfer = await prisma.stockTransfer.create({
            data: {
                item_id: otherItem.id,
                from_location_type: "WAREHOUSE",
                from_location_id: crypto.randomUUID(),
                to_location_type: "HOUSE",
                to_location_id: houseId,
                quantity: 1,
                unit: "BOTTLE",
                base_quantity: 1,
                recorded_by_id: profileId,
                idempotency_key: crypto.randomUUID(),
            },
        });
        createdTransferIds.push(transfer.id);

        await expect(
            StockUnitService.relocate(unit!.id, houseId, crypto.randomUUID(), transfer.id),
        ).rejects.toMatchObject({ status: 400 });

        await prisma.stockTransfer.delete({ where: { id: transfer.id } });
        createdTransferIds.splice(createdTransferIds.indexOf(transfer.id), 1);
        await prisma.item.delete({ where: { id: otherItem.id } });
    });

    test("dispose sets status DISPOSED and rejects double-dispose", async () => {
        const [unit] = await provisionPrinted(1);
        createdUnitIds.push(unit!.id);

        const disposed = await StockUnitService.dispose(unit!.id);
        expect(disposed.status).toBe("DISPOSED");

        await expect(StockUnitService.dispose(unit!.id)).rejects.toMatchObject({ status: 409 });
    });

    test("getById on unknown id throws not-found", async () => {
        await expect(
            StockUnitService.getById("00000000-0000-0000-0000-000000000000"),
        ).rejects.toBeInstanceOf(AppError);
    });

    test("getAll includes item/house/asset and filters by category", async () => {
        const [equipmentUnit] = await provisionPrinted(1);
        createdUnitIds.push(equipmentUnit!.id);

        const equipmentItem = await prisma.item.create({
            data: {
                name: `Test Incubator Item ${crypto.randomUUID()}`,
                normalized_key: `test incubator item ${crypto.randomUUID()}`,
                category: "EQUIPMENT",
                unit: "UNIT",
                is_unit_tracked: true,
            },
        });
        equipmentItemId = equipmentItem.id;
        const equipmentPurchase = await prisma.purchase.create({
            data: {
                warehouse_id: await sharedWarehouseId(),
                purchase_date: new Date(),
                total_amount: 200,
                paid_amount: 200,
                due_amount: 0,
                recorded_by_id: profileId,
            },
        });
        equipmentPurchaseId = equipmentPurchase.id;
        const equipmentPurchaseItem = await prisma.purchaseItem.create({
            data: {
                purchase_id: equipmentPurchase.id,
                item_id: equipmentItem.id,
                quantity: 1,
                unit: "UNIT",
                base_quantity: 1,
                unit_price: 200,
                total_price: 200,
            },
        });
        equipmentPurchaseItemId = equipmentPurchaseItem.id;
        await StockUnitService.bind(equipmentUnit!.id, {
            purchase_item_id: equipmentPurchaseItem.id,
        });
        await StockUnitService.relocate(equipmentUnit!.id, houseId, crypto.randomUUID());

        const { stockUnits } = await StockUnitService.getAll({
            page: 1,
            limit: 100,
            category: "EQUIPMENT",
        });
        const found = stockUnits.find((u) => u.id === equipmentUnit!.id);
        expect(found).toBeDefined();
        expect(found!.purchase_item?.item.name).toBe(equipmentItem.name);
        expect(found!.houseAllocations[0]?.house?.id).toBe(houseId);

        const [medicineUnit] = await provisionPrinted(1);
        createdUnitIds.push(medicineUnit!.id);
        await StockUnitService.bind(medicineUnit!.id, { purchase_item_id: purchaseItemId }); // medicine, from beforeAll

        const { stockUnits: equipmentOnly } = await StockUnitService.getAll({
            page: 1,
            limit: 100,
            category: "EQUIPMENT",
        });
        expect(equipmentOnly.some((u) => u.id === medicineUnit!.id)).toBe(false);
    });

    test("setStatus: CONSUMED writes off the remainder and can then only be disposed; DISPOSED is final", async () => {
        const unit = await boundUnit();
        const before = await prisma.stockLedger.count({
            where: { ref_id: unit.id, reason: "WASTAGE" },
        });
        expect((await StockUnitService.setStatus(unit.id, "CONSUMED")).status).toBe("CONSUMED");
        expect(
            await prisma.stockLedger.count({
                where: { ref_id: unit.id, reason: "WASTAGE" },
            }),
        ).toBe(before + 1);
        await expect(StockUnitService.setStatus(unit.id, "BOUND")).rejects.toMatchObject({
            status: 409,
        });
        expect((await StockUnitService.setStatus(unit.id, "DISPOSED")).status).toBe("DISPOSED");
        // already written off as CONSUMED: disposing posts nothing more
        expect(
            await prisma.stockLedger.count({
                where: { ref_id: unit.id, reason: "WASTAGE" },
            }),
        ).toBe(before + 1);
        await expect(StockUnitService.setStatus(unit.id, "IN_USE")).rejects.toMatchObject({
            status: 409,
        });
        await expect(
            StockUnitService.setStatus((await boundUnit()).id, "UNASSIGNED"),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("relocate refuses a blank code, a disposed unit, and an inactive house", async () => {
        const [blank] = await provisionPrinted(1);
        createdUnitIds.push(blank!.id);
        await expect(
            StockUnitService.relocate(blank!.id, houseId, crypto.randomUUID()),
        ).rejects.toMatchObject({ status: 400 });
        const gone = await boundUnit();
        await StockUnitService.dispose(gone.id);
        await expect(
            StockUnitService.relocate(gone.id, houseId, crypto.randomUUID()),
        ).rejects.toMatchObject({ status: 409 });
        const live = await boundUnit();
        await prisma.houses.update({ where: { id: houseId }, data: { is_active: false } });
        try {
            await expect(
                StockUnitService.relocate(live.id, houseId, crypto.randomUUID()),
            ).rejects.toMatchObject({ status: 400 });
        } finally {
            await prisma.houses.update({ where: { id: houseId }, data: { is_active: true } });
        }
    });

    test("remove hard-deletes a never-used unit and purges its house allocations", async () => {
        const unit = await boundUnit();
        await StockUnitService.relocate(unit!.id, houseId, crypto.randomUUID());

        await StockUnitService.remove(unit!.id);

        await expect(StockUnitService.getById(unit!.id)).rejects.toBeInstanceOf(AppError);
        const orphans = await prisma.stockHouseAllocation.count({
            where: { stock_unit_id: unit!.id },
        });
        expect(orphans).toBe(0);
    });

    test("remove refuses a unit that has consumption history", async () => {
        const [unit] = await provisionPrinted(1);
        createdUnitIds.push(unit!.id);
        const consumption = await prisma.consumption.create({
            data: {
                house_id: houseId,
                item_id: itemId,
                quantity: 1,
                unit: "BOTTLE",
                base_quantity: 1,
                date: new Date(),
                recorded_by_id: profileId,
                idempotency_key: crypto.randomUUID(),
                stock_unit_id: unit!.id,
            },
        });

        await expect(StockUnitService.remove(unit!.id)).rejects.toMatchObject({ status: 409 });

        await prisma.consumption.delete({ where: { id: consumption.id } });
    });
});
