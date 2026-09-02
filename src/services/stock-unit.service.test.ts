import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { StockUnitService } from "./stock-unit.service";
import { AppError } from "@lib/app-error";

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
            data: { name: "Seed House", type: "BROODER", number: 99 },
        });
        houseId = house.id;
    });

    afterAll(async () => {
        await prisma.stockHouseAllocation.deleteMany({
            where: { stock_unit_id: { in: createdUnitIds } },
        });
        await prisma.stockUnit.deleteMany({ where: { id: { in: createdUnitIds } } });
        await prisma.stockTransfer.deleteMany({ where: { id: { in: createdTransferIds } } });
        await prisma.purchaseItem.delete({ where: { id: purchaseItemId } });
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

    test("bind transitions UNASSIGNED -> IN_STOCK", async () => {
        const [unit] = await StockUnitService.provision(1);
        createdUnitIds.push(unit!.id);

        const bound = await StockUnitService.bind(unit!.id, {
            purchase_item_id: purchaseItemId,
        });
        expect(bound.status).toBe("IN_STOCK");
        expect(bound.purchase_item_id).toBe(purchaseItemId);
        expect(bound.bound_at).not.toBeNull();
    });

    test("binding to a nonexistent purchase_item_id throws bad-request, not a raw 500", async () => {
        const [unit] = await StockUnitService.provision(1);
        createdUnitIds.push(unit!.id);

        await expect(
            StockUnitService.bind(unit!.id, {
                purchase_item_id: "00000000-0000-0000-0000-000000000000",
            }),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("binding an already-bound unit throws a conflict", async () => {
        const [unit] = await StockUnitService.provision(1);
        createdUnitIds.push(unit!.id);
        await StockUnitService.bind(unit!.id, { purchase_item_id: purchaseItemId });

        await expect(
            StockUnitService.bind(unit!.id, { purchase_item_id: purchaseItemId }),
        ).rejects.toMatchObject({ status: 409 });
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

        const [unit] = await StockUnitService.provision(1);
        createdUnitIds.push(unit!.id);
        await expect(
            StockUnitService.bind(unit!.id, { purchase_item_id: untrackedPurchaseItem.id }),
        ).rejects.toMatchObject({ status: 400 });

        await prisma.purchaseItem.delete({ where: { id: untrackedPurchaseItem.id } });
        await prisma.purchase.delete({ where: { id: untrackedPurchase.id } });
        await prisma.item.delete({ where: { id: untrackedItem.id } });
    });

    test("relocate logs a house allocation", async () => {
        const [unit] = await StockUnitService.provision(1);
        createdUnitIds.push(unit!.id);

        const relocated = await StockUnitService.relocate(unit!.id, houseId, crypto.randomUUID());
        expect(relocated.house_id).toBe(houseId);
        expect(relocated.stock_unit_id).toBe(unit!.id);
    });

    test("relocate infers ALLOCATION on first move, REALLOCATION on a house->house move, RETURN to warehouse", async () => {
        const [unit] = await StockUnitService.provision(1);
        createdUnitIds.push(unit!.id);
        const houseTwo = await prisma.houses.create({
            data: { name: "Seed House Two", type: "BROODER", number: 98 },
        });

        const allocated = await StockUnitService.relocate(unit!.id, houseId, crypto.randomUUID());
        expect(allocated.type).toBe("ALLOCATION");

        const reallocated = await StockUnitService.relocate(unit!.id, houseTwo.id, crypto.randomUUID());
        expect(reallocated.type).toBe("REALLOCATION");
        expect(reallocated.house_id).toBe(houseTwo.id);

        const returned = await StockUnitService.relocate(unit!.id, null, crypto.randomUUID());
        expect(returned.type).toBe("RETURN");
        expect(returned.house_id).toBeNull();

        const reAllocated = await StockUnitService.relocate(unit!.id, houseId, crypto.randomUUID());
        expect(reAllocated.type).toBe("ALLOCATION");

        await prisma.houses.delete({ where: { id: houseTwo.id } });
    });

    test("relocate rejects a no-op move (same house, or already at the warehouse)", async () => {
        const [unit] = await StockUnitService.provision(1);
        createdUnitIds.push(unit!.id);

        await expect(StockUnitService.relocate(unit!.id, null, crypto.randomUUID())).rejects.toMatchObject({
            status: 409,
        });

        await StockUnitService.relocate(unit!.id, houseId, crypto.randomUUID());
        await expect(
            StockUnitService.relocate(unit!.id, houseId, crypto.randomUUID()),
        ).rejects.toMatchObject({ status: 409 });
    });

    test("relocate with a stock_transfer_id for the unit's own item stores it on the allocation row", async () => {
        const [unit] = await StockUnitService.provision(1);
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
        const [unit] = await StockUnitService.provision(1);
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
        const [unit] = await StockUnitService.provision(1);
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
        const [unit] = await StockUnitService.provision(1);
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
        const [equipmentUnit] = await StockUnitService.provision(1);
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
        await StockUnitService.bind(equipmentUnit!.id, { purchase_item_id: equipmentPurchaseItem.id });
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

        const [medicineUnit] = await StockUnitService.provision(1);
        createdUnitIds.push(medicineUnit!.id);
        await StockUnitService.bind(medicineUnit!.id, { purchase_item_id: purchaseItemId }); // medicine, from beforeAll

        const { stockUnits: equipmentOnly } = await StockUnitService.getAll({
            page: 1,
            limit: 100,
            category: "EQUIPMENT",
        });
        expect(equipmentOnly.some((u) => u.id === medicineUnit!.id)).toBe(false);
    });

    test("setStatus sets an arbitrary status with no transition guard", async () => {
        const [unit] = await StockUnitService.provision(1);
        createdUnitIds.push(unit!.id);

        const updated = await StockUnitService.setStatus(unit!.id, "CONSUMED");
        expect(updated.status).toBe("CONSUMED");
    });

    test("remove hard-deletes an unbound unit and purges its house allocations", async () => {
        const [unit] = await StockUnitService.provision(1);
        await StockUnitService.relocate(unit!.id, houseId, crypto.randomUUID());

        await StockUnitService.remove(unit!.id);

        await expect(StockUnitService.getById(unit!.id)).rejects.toBeInstanceOf(AppError);
        const orphans = await prisma.stockHouseAllocation.count({
            where: { stock_unit_id: unit!.id },
        });
        expect(orphans).toBe(0);
    });

    test("remove refuses a unit that has consumption history", async () => {
        const [unit] = await StockUnitService.provision(1);
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
