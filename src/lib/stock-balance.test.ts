import { describe, test, expect, afterAll } from "bun:test";
import prisma from "@lib/db";
import { getItemBalances, getLocationStock, getItemLocationBalance } from "./stock-balance";

const createdItemIds: string[] = [];

describe("getItemBalances", () => {
    afterAll(async () => {
        await prisma.stockLedger.deleteMany({ where: { item_id: { in: createdItemIds } } });
        await prisma.item.deleteMany({ where: { id: { in: createdItemIds } } });
    });

    test("nets IN minus OUT per item in one pass", async () => {
        const item = await prisma.item.create({
            data: {
                name: `Balance Test ${crypto.randomUUID()}`,
                normalized_key: `balance test ${crypto.randomUUID()}`,
                category: "FEED",
                unit: "BAG",
            },
        });
        createdItemIds.push(item.id);

        await prisma.stockLedger.createMany({
            data: [
                {
                    item_id: item.id,
                    quantity: 100,
                    direction: "IN",
                    reason: "OPENING_BALANCE",
                    ref_type: "ADJUSTMENT",
                    ref_id: crypto.randomUUID(),
                    idempotency_key: crypto.randomUUID(),
                },
                {
                    item_id: item.id,
                    quantity: 30,
                    direction: "OUT",
                    reason: "CONSUMPTION",
                    ref_type: "CONSUMPTION",
                    ref_id: crypto.randomUUID(),
                    idempotency_key: crypto.randomUUID(),
                },
            ],
        });

        const balances = await getItemBalances([item.id]);
        expect(balances.get(item.id)?.toNumber()).toBe(70);
    });

    test("returns zero for an item with no ledger entries", async () => {
        const item = await prisma.item.create({
            data: {
                name: `Empty Balance ${crypto.randomUUID()}`,
                normalized_key: `empty balance ${crypto.randomUUID()}`,
                category: "FEED",
                unit: "BAG",
            },
        });
        createdItemIds.push(item.id);

        const balances = await getItemBalances([item.id]);
        expect(balances.get(item.id)?.toNumber()).toBe(0);
    });

    test("empty input returns an empty map without querying", async () => {
        const balances = await getItemBalances([]);
        expect(balances.size).toBe(0);
    });
});

describe("getLocationStock and getItemLocationBalance", () => {
    const createdItemIds: string[] = [];

    afterAll(async () => {
        await prisma.stockLedger.deleteMany({ where: { item_id: { in: createdItemIds } } });
        await prisma.item.deleteMany({ where: { id: { in: createdItemIds } } });
    });

    test("getLocationStock sums IN minus OUT per item at a specific location, ignoring other locations and untagged rows", async () => {
        const item = await prisma.item.create({
            data: {
                name: `Location Stock Test ${crypto.randomUUID()}`,
                normalized_key: `location stock test ${crypto.randomUUID()}`,
                category: "FEED",
                unit: "G",
            },
        });
        createdItemIds.push(item.id);
        const houseId = crypto.randomUUID();
        const otherHouseId = crypto.randomUUID();

        await prisma.stockLedger.createMany({
            data: [
                {
                    item_id: item.id, quantity: 100, direction: "IN", reason: "TRANSFER",
                    ref_type: "TRANSFER", ref_id: crypto.randomUUID(), idempotency_key: crypto.randomUUID(),
                    location_type: "HOUSE", location_id: houseId,
                },
                {
                    item_id: item.id, quantity: 30, direction: "OUT", reason: "CONSUMPTION",
                    ref_type: "CONSUMPTION", ref_id: crypto.randomUUID(), idempotency_key: crypto.randomUUID(),
                    location_type: "HOUSE", location_id: houseId,
                },
                {
                    item_id: item.id, quantity: 500, direction: "IN", reason: "TRANSFER",
                    ref_type: "TRANSFER", ref_id: crypto.randomUUID(), idempotency_key: crypto.randomUUID(),
                    location_type: "HOUSE", location_id: otherHouseId,
                },
                {
                    item_id: item.id, quantity: 1000, direction: "IN", reason: "PURCHASE",
                    ref_type: "PURCHASE", ref_id: crypto.randomUUID(), idempotency_key: crypto.randomUUID(),
                },
            ],
        });

        const stock = await getLocationStock("HOUSE", houseId);
        const row = stock.find((s) => s.item_id === item.id);
        expect(row?.balance.toNumber()).toBe(70);
    });

    test("getItemLocationBalance returns the same net figure for one item at one location, inside a transaction", async () => {
        const item = await prisma.item.create({
            data: {
                name: `Item Location Balance Test ${crypto.randomUUID()}`,
                normalized_key: `item location balance test ${crypto.randomUUID()}`,
                category: "FEED",
                unit: "G",
            },
        });
        createdItemIds.push(item.id);
        const warehouseId = crypto.randomUUID();

        await prisma.stockLedger.create({
            data: {
                item_id: item.id, quantity: 250, direction: "IN", reason: "PURCHASE",
                ref_type: "PURCHASE", ref_id: crypto.randomUUID(), idempotency_key: crypto.randomUUID(),
                location_type: "WAREHOUSE", location_id: warehouseId,
            },
        });

        const balance = await prisma.$transaction((tx) =>
            getItemLocationBalance(tx, item.id, "WAREHOUSE", warehouseId),
        );
        expect(balance.toNumber()).toBe(250);
    });

    test("getItemLocationBalance returns zero for a location with no activity", async () => {
        const item = await prisma.item.create({
            data: {
                name: `No Activity Test ${crypto.randomUUID()}`,
                normalized_key: `no activity test ${crypto.randomUUID()}`,
                category: "FEED",
                unit: "G",
            },
        });
        createdItemIds.push(item.id);

        const balance = await prisma.$transaction((tx) =>
            getItemLocationBalance(tx, item.id, "WAREHOUSE", crypto.randomUUID()),
        );
        expect(balance.toNumber()).toBe(0);
    });
});
