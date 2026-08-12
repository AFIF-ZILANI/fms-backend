import { describe, test, expect, afterAll } from "bun:test";
import prisma from "@lib/db";
import { getItemBalances } from "./stock-balance";

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
