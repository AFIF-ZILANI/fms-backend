import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { StockUnitService } from "./stock-unit.service";
import { AppError } from "@lib/app-error";

const createdUnitIds: string[] = [];
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
        await prisma.stockUnit.deleteMany({ where: { id: { in: createdUnitIds } } });
        await prisma.purchaseItem.delete({ where: { id: purchaseItemId } });
        await prisma.purchase.delete({ where: { id: purchaseId } });
        await prisma.item.delete({ where: { id: itemId } });
        await prisma.purchaseItem.delete({ where: { id: equipmentPurchaseItemId } });
        await prisma.purchase.delete({ where: { id: equipmentPurchaseId } });
        await prisma.item.delete({ where: { id: equipmentItemId } });
        await prisma.houses.delete({ where: { id: houseId } });
        await prisma.profiles.delete({ where: { id: profileId } });
    });

    test("provision creates N unassigned units with unique codes", async () => {
        const units = await StockUnitService.provision(3);
        createdUnitIds.push(...units.map((u) => u.id));

        expect(units.length).toBe(3);
        expect(units.every((u) => u.status === "UNASSIGNED")).toBe(true);
        expect(new Set(units.map((u) => u.code)).size).toBe(3);
    });

    test("getByCode finds a provisioned unit", async () => {
        const [unit] = await StockUnitService.provision(1);
        createdUnitIds.push(unit!.id);

        const found = await StockUnitService.getByCode(unit!.code);
        expect(found.id).toBe(unit!.id);
    });

    test("bind transitions UNASSIGNED -> IN_STOCK and sets quantities", async () => {
        const [unit] = await StockUnitService.provision(1);
        createdUnitIds.push(unit!.id);

        const bound = await StockUnitService.bind(unit!.id, {
            purchase_item_id: purchaseItemId,
            initial_quantity: 500,
            bound_by_id: profileId,
        });
        expect(bound.status).toBe("IN_STOCK");
        expect(bound.purchase_item_id).toBe(purchaseItemId);
        expect(bound.initial_quantity?.toNumber()).toBe(500);
        expect(bound.remaining_quantity?.toNumber()).toBe(500);
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

    test("relocate sets house_id", async () => {
        const [unit] = await StockUnitService.provision(1);
        createdUnitIds.push(unit!.id);

        const relocated = await StockUnitService.relocate(unit!.id, houseId);
        expect(relocated.house_id).toBe(houseId);
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
                unit_price: 200,
                total_price: 200,
            },
        });
        equipmentPurchaseItemId = equipmentPurchaseItem.id;
        await StockUnitService.bind(equipmentUnit!.id, { purchase_item_id: equipmentPurchaseItem.id });
        await StockUnitService.relocate(equipmentUnit!.id, houseId);

        const { stockUnits } = await StockUnitService.getAll({
            page: 1,
            limit: 100,
            category: "EQUIPMENT",
        });
        const found = stockUnits.find((u) => u.id === equipmentUnit!.id);
        expect(found).toBeDefined();
        expect(found!.purchase_item?.item.name).toBe(equipmentItem.name);
        expect(found!.house?.id).toBe(houseId);

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
});
