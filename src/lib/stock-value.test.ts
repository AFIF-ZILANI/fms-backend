import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { getItemAvgCosts } from "./stock-value";

let itemId: string;
let purchaseId: string;
let profileId: string;
const purchaseItemIds: string[] = [];

describe("getItemAvgCosts", () => {
    beforeAll(async () => {
        const item = await prisma.item.create({
            data: {
                name: `Avg Cost Test ${crypto.randomUUID()}`,
                normalized_key: `avg cost test ${crypto.randomUUID()}`,
                category: "FEED",
                unit: "KG",
            },
        });
        itemId = item.id;

        const profile = await prisma.profiles.create({
            data: {
                name: "Avg Cost Recorder",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "ADMIN",
            },
        });
        profileId = profile.id;

        const purchase = await prisma.purchase.create({
            data: {
                purchase_date: new Date(),
                total_amount: 1150,
                paid_amount: 1150,
                due_amount: 0,
                recorded_by_id: profileId,
            },
        });
        purchaseId = purchase.id;

        // 1 BAG @ 50kg, total 1000 -> 20/kg
        const bagLine = await prisma.purchaseItem.create({
            data: {
                purchase_id: purchaseId,
                item_id: itemId,
                quantity: 1,
                unit: "BAG",
                base_quantity: 50,
                unit_price: 1000,
                total_price: 1000,
            },
        });
        // 10 KG @ 15/kg, total 150
        const kgLine = await prisma.purchaseItem.create({
            data: {
                purchase_id: purchaseId,
                item_id: itemId,
                quantity: 10,
                unit: "KG",
                base_quantity: 10,
                unit_price: 15,
                total_price: 150,
            },
        });
        purchaseItemIds.push(bagLine.id, kgLine.id);
    });

    afterAll(async () => {
        await prisma.purchaseItem.deleteMany({ where: { id: { in: purchaseItemIds } } });
        await prisma.purchase.delete({ where: { id: purchaseId } });
        await prisma.item.delete({ where: { id: itemId } });
        await prisma.profiles.delete({ where: { id: profileId } });
    });

    test("averages cost per base unit across purchases entered in different units", async () => {
        const costs = await getItemAvgCosts([itemId]);
        // (1000 + 150) / (50 + 10) = 1150 / 60 = 19.1666...
        expect(costs.get(itemId)?.toNumber()).toBeCloseTo(19.1667, 3);
    });

    test("an item never purchased is absent from the map", async () => {
        const costs = await getItemAvgCosts(["00000000-0000-0000-0000-000000000000"]);
        expect(costs.has("00000000-0000-0000-0000-000000000000")).toBe(false);
    });
});
