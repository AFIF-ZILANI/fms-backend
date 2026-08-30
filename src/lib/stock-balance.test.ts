import { describe, test, expect, afterAll } from "bun:test";
import prisma from "@lib/db";
import { getItemBalances, getLocationStock, getItemLocationBalance, getStockByLocation } from "./stock-balance";

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

describe("getStockByLocation", () => {
    const createdItemIds: string[] = [];
    const createdWarehouseIds: string[] = [];
    const createdHouseIds: string[] = [];

    afterAll(async () => {
        await prisma.stockLedger.deleteMany({ where: { item_id: { in: createdItemIds } } });
        await prisma.item.deleteMany({ where: { id: { in: createdItemIds } } });
        await prisma.warehouses.deleteMany({ where: { id: { in: createdWarehouseIds } } });
        await prisma.houses.deleteMany({ where: { id: { in: createdHouseIds } } });
    });

    test("splits one item across warehouse and house with resolved names, excluding untagged and DISPOSAL rows", async () => {
        const item = await prisma.item.create({
            data: {
                name: `Stock By Location ${crypto.randomUUID()}`,
                normalized_key: `stock by location ${crypto.randomUUID()}`,
                category: "FEED",
                unit: "KG",
            },
        });
        createdItemIds.push(item.id);
        const warehouse = await prisma.warehouses.create({ data: { name: `WH ${crypto.randomUUID()}` } });
        createdWarehouseIds.push(warehouse.id);
        const house = await prisma.houses.create({ data: { name: `H ${crypto.randomUUID()}`, type: "GROWER", number: 99 } });
        createdHouseIds.push(house.id);

        await prisma.stockLedger.createMany({
            data: [
                {
                    item_id: item.id, quantity: 300, direction: "IN", reason: "PURCHASE",
                    ref_type: "PURCHASE", ref_id: crypto.randomUUID(), idempotency_key: crypto.randomUUID(),
                    location_type: "WAREHOUSE", location_id: warehouse.id,
                },
                {
                    item_id: item.id, quantity: 50, direction: "OUT", reason: "TRANSFER",
                    ref_type: "TRANSFER", ref_id: crypto.randomUUID(), idempotency_key: crypto.randomUUID(),
                    location_type: "WAREHOUSE", location_id: warehouse.id,
                },
                {
                    item_id: item.id, quantity: 50, direction: "IN", reason: "TRANSFER",
                    ref_type: "TRANSFER", ref_id: crypto.randomUUID(), idempotency_key: crypto.randomUUID(),
                    location_type: "HOUSE", location_id: house.id,
                },
                // Untagged (no location) -- must not appear in any location's breakdown.
                {
                    item_id: item.id, quantity: 999, direction: "IN", reason: "OPENING_BALANCE",
                    ref_type: "ADJUSTMENT", ref_id: crypto.randomUUID(), idempotency_key: crypto.randomUUID(),
                },
                // DISPOSAL -- excluded: not stock at a warehouse or house.
                {
                    item_id: item.id, quantity: 10, direction: "OUT", reason: "WASTAGE",
                    ref_type: "ADJUSTMENT", ref_id: crypto.randomUUID(), idempotency_key: crypto.randomUUID(),
                    location_type: "DISPOSAL", location_id: crypto.randomUUID(),
                },
            ],
        });

        const rows = (await getStockByLocation()).filter((r) => r.item_id === item.id);
        const wh = rows.find((r) => r.location_type === "WAREHOUSE");
        const h = rows.find((r) => r.location_type === "HOUSE");

        expect(rows.length).toBe(2);
        expect(wh?.balance.toNumber()).toBe(250);
        expect(wh?.location_name).toBe(warehouse.name);
        expect(h?.balance.toNumber()).toBe(50);
        expect(h?.location_name).toBe(house.name);
    });

    test("omits a location whose net balance is zero", async () => {
        const item = await prisma.item.create({
            data: {
                name: `Zeroed Location ${crypto.randomUUID()}`,
                normalized_key: `zeroed location ${crypto.randomUUID()}`,
                category: "FEED",
                unit: "KG",
            },
        });
        createdItemIds.push(item.id);
        const warehouse = await prisma.warehouses.create({ data: { name: `WH ${crypto.randomUUID()}` } });
        createdWarehouseIds.push(warehouse.id);

        await prisma.stockLedger.createMany({
            data: [
                {
                    item_id: item.id, quantity: 40, direction: "IN", reason: "PURCHASE",
                    ref_type: "PURCHASE", ref_id: crypto.randomUUID(), idempotency_key: crypto.randomUUID(),
                    location_type: "WAREHOUSE", location_id: warehouse.id,
                },
                {
                    item_id: item.id, quantity: 40, direction: "OUT", reason: "TRANSFER",
                    ref_type: "TRANSFER", ref_id: crypto.randomUUID(), idempotency_key: crypto.randomUUID(),
                    location_type: "WAREHOUSE", location_id: warehouse.id,
                },
            ],
        });

        const rows = (await getStockByLocation()).filter((r) => r.item_id === item.id);
        expect(rows.length).toBe(0);
    });
});
