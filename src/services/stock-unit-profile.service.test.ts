import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { StockUnitService } from "./stock-unit.service";
import { stockUnitProfile } from "./stock-unit-profile.service";
import { houseNumber, sharedWarehouseId, provisionPrinted } from "@lib/test-fixtures";

const unitIds: string[] = [];
let profileId: string;
let itemId: string;
let purchaseId: string;
let lotId: string;
let houseId: string;

describe("stockUnitProfile", () => {
    beforeAll(async () => {
        const profile = await prisma.profiles.create({
            data: {
                name: "Profile Buyer",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "ADMIN",
            },
        });
        profileId = profile.id;
        const item = await prisma.item.create({
            data: {
                name: `Profile Vaccine ${crypto.randomUUID()}`,
                normalized_key: `profile vaccine ${crypto.randomUUID()}`,
                category: "VACCINE",
                unit: "BOTTLE",
                is_unit_tracked: true,
            },
        });
        itemId = item.id;
        const purchase = await prisma.purchase.create({
            data: {
                warehouse_id: await sharedWarehouseId(),
                invoice_no: "INV-PROFILE-1",
                purchase_date: new Date("2026-10-20T00:00:00Z"),
                total_amount: 100,
                paid_amount: 0,
                due_amount: 100,
                recorded_by_id: profile.id,
            },
        });
        purchaseId = purchase.id;
        const lot = await prisma.purchaseItem.create({
            data: {
                purchase_id: purchase.id,
                item_id: item.id,
                quantity: 5,
                unit: "BOTTLE",
                base_quantity: 5,
                unit_count: 5,
                unit_price: 20,
                total_price: 100,
                expiration_date: new Date("2027-01-31T00:00:00Z"),
            },
        });
        lotId = lot.id;
        const house = await prisma.houses.create({
            data: { name: "Profile House", type: "BROODER", number: houseNumber() },
        });
        houseId = house.id;
    });

    afterAll(async () => {
        await prisma.stockHouseAllocation.deleteMany({ where: { stock_unit_id: { in: unitIds } } });
        await prisma.stockLedger.deleteMany({ where: { item_id: itemId } });
        await prisma.stockTransfer.deleteMany({ where: { item_id: itemId } });
        await prisma.stockUnit.deleteMany({ where: { id: { in: unitIds } } });
        await prisma.purchaseItem.delete({ where: { id: lotId } });
        await prisma.purchase.delete({ where: { id: purchaseId } });
        await prisma.item.delete({ where: { id: itemId } });
        await prisma.houses.delete({ where: { id: houseId } });
        await prisma.profiles.delete({ where: { id: profileId } });
    });

    test("a blank code says so: no item, lot or location", async () => {
        const [blank] = await provisionPrinted(1);
        unitIds.push(blank!.id);
        const p = await stockUnitProfile(blank!.id);
        expect(p).toMatchObject({
            status: "PRINTED",
            item: null,
            lot: null,
            purchase: null,
            location: null,
        });
        expect(p.movements).toEqual([]);
    });

    test("a bound unit moved into a house: lot, price, purchase, where it is, its moves", async () => {
        const [code] = await provisionPrinted(1);
        unitIds.push(code!.id);
        await StockUnitService.bind(code!.id, { purchase_item_id: lotId });
        await StockUnitService.relocate(
            code!.id,
            houseId,
            crypto.randomUUID(),
            undefined,
            profileId,
        );

        const p = await stockUnitProfile(code!.id);
        expect(p.item?.category).toBe("VACCINE");
        expect(p.location).toMatchObject({ type: "HOUSE", name: "Profile House" });
        expect(p.lot).toMatchObject({ unit_count: 5, unit_price: "20", cost_per_unit: "20" });
        expect(p.lot?.codes.BOUND).toBe(1);
        expect(p.purchase).toMatchObject({
            invoice_no: "INV-PROFILE-1",
            supplier: null,
            recorded_by: "Profile Buyer",
        });
        expect(p.remaining).toEqual({ unit: "1", lot: "5" });
        expect(p.movements).toEqual([
            expect.objectContaining({
                type: "ALLOCATION",
                house: "Profile House",
                by: "Profile Buyer",
            }),
        ]);
        expect(p.uses).toEqual([]);
    });

    test("an unknown code is a 404", async () => {
        await expect(stockUnitProfile(crypto.randomUUID())).rejects.toMatchObject({ status: 404 });
    });
});
