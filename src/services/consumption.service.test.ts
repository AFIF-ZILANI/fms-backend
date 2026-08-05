import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { ConsumptionService } from "./consumption.service";
import { StockUnitService } from "./stock-unit.service";

let houseId: string;
let feedItemId: string;
let medicineItemId: string;
let profileId: string;
let purchaseId: string;
let purchaseItemId: string;
const createdConsumptionIds: string[] = [];
const createdStockUnitIds: string[] = [];

describe("ConsumptionService", () => {
    beforeAll(async () => {
        const house = await prisma.houses.create({
            data: { name: "Consumption House", type: "GROWER", number: 401 },
        });
        houseId = house.id;

        const profile = await prisma.profiles.create({
            data: {
                name: "Consumption Recorder",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "ADMIN",
            },
        });
        profileId = profile.id;

        const feedItem = await prisma.item.create({
            data: {
                name: `Feed ${crypto.randomUUID()}`,
                normalized_key: `feed ${crypto.randomUUID()}`,
                category: "FEED",
                unit: "BAG",
            },
        });
        feedItemId = feedItem.id;

        const medicineItem = await prisma.item.create({
            data: {
                name: `Antibiotic ${crypto.randomUUID()}`,
                normalized_key: `antibiotic ${crypto.randomUUID()}`,
                category: "MEDICINE",
                unit: "BOTTLE",
            },
        });
        medicineItemId = medicineItem.id;

        const purchase = await prisma.purchase.create({
            data: {
                purchase_date: new Date(),
                total_amount: 50,
                paid_amount: 50,
                due_amount: 0,
                recorded_by_id: profile.id,
            },
        });
        purchaseId = purchase.id;
        const purchaseItem = await prisma.purchaseItem.create({
            data: {
                purchase_id: purchase.id,
                item_id: medicineItem.id,
                quantity: 1,
                unit: "BOTTLE",
                unit_price: 50,
                total_price: 50,
            },
        });
        purchaseItemId = purchaseItem.id;
    });

    afterAll(async () => {
        await prisma.consumption.deleteMany({ where: { id: { in: createdConsumptionIds } } });
        await prisma.stockLedger.deleteMany({ where: { item_id: feedItemId } });
        await prisma.stockUnit.deleteMany({ where: { id: { in: createdStockUnitIds } } });
        await prisma.purchaseItem.delete({ where: { id: purchaseItemId } });
        await prisma.purchase.delete({ where: { id: purchaseId } });
        await prisma.item.deleteMany({ where: { id: { in: [feedItemId, medicineItemId] } } });
        await prisma.houses.delete({ where: { id: houseId } });
        await prisma.profiles.delete({ where: { id: profileId } });
    });

    test("aggregate draw (no stock_unit_id) writes a StockLedger OUT entry", async () => {
        const consumption = await ConsumptionService.create({
            house_id: houseId,
            item_id: feedItemId,
            quantity: 25,
            date: new Date(),
            recorded_by_id: profileId,
        });
        createdConsumptionIds.push(consumption!.id);

        const ledgerEntry = await prisma.stockLedger.findFirst({
            where: { ref_type: "CONSUMPTION", ref_id: consumption!.id },
        });
        expect(ledgerEntry?.direction).toBe("OUT");
        expect(ledgerEntry?.quantity.toNumber()).toBe(25);
    });

    test("coded draw decrements StockUnit.remaining_quantity and flips to IN_USE", async () => {
        const [unit] = await StockUnitService.provision(1);
        createdStockUnitIds.push(unit!.id);
        await StockUnitService.bind(unit!.id, {
            purchase_item_id: purchaseItemId,
            initial_quantity: 100,
        });

        const consumption = await ConsumptionService.create({
            house_id: houseId,
            item_id: medicineItemId,
            stock_unit_id: unit!.id,
            quantity: 30,
            date: new Date(),
            recorded_by_id: profileId,
        });
        createdConsumptionIds.push(consumption!.id);

        const updatedUnit = await prisma.stockUnit.findUniqueOrThrow({ where: { id: unit!.id } });
        expect(updatedUnit.remaining_quantity?.toNumber()).toBe(70);
        expect(updatedUnit.status).toBe("IN_USE");

        // coded draws don't touch StockLedger -- that's the aggregate path only
        const ledgerEntry = await prisma.stockLedger.findFirst({
            where: { ref_type: "CONSUMPTION", ref_id: consumption!.id },
        });
        expect(ledgerEntry).toBeNull();
    });

    test("coded draw that exactly empties the unit flips to CONSUMED", async () => {
        const [unit] = await StockUnitService.provision(1);
        createdStockUnitIds.push(unit!.id);
        await StockUnitService.bind(unit!.id, {
            purchase_item_id: purchaseItemId,
            initial_quantity: 10,
        });

        const consumption = await ConsumptionService.create({
            house_id: houseId,
            item_id: medicineItemId,
            stock_unit_id: unit!.id,
            quantity: 10,
            date: new Date(),
            recorded_by_id: profileId,
        });
        createdConsumptionIds.push(consumption!.id);

        const updatedUnit = await prisma.stockUnit.findUniqueOrThrow({ where: { id: unit!.id } });
        expect(updatedUnit.status).toBe("CONSUMED");
        expect(updatedUnit.remaining_quantity?.toNumber()).toBe(0);
    });

    test("coded draw exceeding remaining_quantity throws a conflict and rolls back", async () => {
        const [unit] = await StockUnitService.provision(1);
        createdStockUnitIds.push(unit!.id);
        await StockUnitService.bind(unit!.id, {
            purchase_item_id: purchaseItemId,
            initial_quantity: 5,
        });

        await expect(
            ConsumptionService.create({
                house_id: houseId,
                item_id: medicineItemId,
                stock_unit_id: unit!.id,
                quantity: 50,
                date: new Date(),
                recorded_by_id: profileId,
            }),
        ).rejects.toMatchObject({ status: 409 });

        const untouchedUnit = await prisma.stockUnit.findUniqueOrThrow({ where: { id: unit!.id } });
        expect(untouchedUnit.remaining_quantity?.toNumber()).toBe(5);
        expect(untouchedUnit.status).toBe("IN_STOCK");
    });

    test("drawing from a DISPOSED unit throws a conflict", async () => {
        const [unit] = await StockUnitService.provision(1);
        createdStockUnitIds.push(unit!.id);
        await StockUnitService.dispose(unit!.id);

        await expect(
            ConsumptionService.create({
                house_id: houseId,
                item_id: medicineItemId,
                stock_unit_id: unit!.id,
                quantity: 1,
                date: new Date(),
                recorded_by_id: profileId,
            }),
        ).rejects.toMatchObject({ status: 409 });
    });
});
