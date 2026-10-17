import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { houseNumber, sharedWarehouseId } from "@lib/test-fixtures";
import { HouseService } from "./house.service";

// Which coded units count as "in this house": the latest move was into it, and it hasn't been used.
describe("HouseService.getCodedStock", () => {
    let profileId: string, houseId: string, otherId: string, purchaseId: string;
    let itemA: string, itemB: string, lotA: string, lotB: string;
    const unitIds: string[] = [];
    const allocIds: string[] = [];
    const t0 = Date.now() - 60_000;

    beforeAll(async () => {
        profileId = (
            await prisma.profiles.create({
                data: {
                    name: "Seed Admin",
                    mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                    role: "ADMIN",
                },
            })
        ).id;
        houseId = (
            await prisma.houses.create({
                data: { name: "Stock House", type: "BROODER", number: houseNumber() },
            })
        ).id;
        otherId = (
            await prisma.houses.create({
                data: { name: "Other House", type: "BROODER", number: houseNumber() },
            })
        ).id;

        const mkItem = async (label: string) =>
            (
                await prisma.item.create({
                    data: {
                        name: `${label} ${crypto.randomUUID()}`,
                        normalized_key: `${label} ${crypto.randomUUID()}`.toLowerCase(),
                        category: "MEDICINE",
                        unit: "LITER",
                        is_unit_tracked: true,
                    },
                })
            ).id;
        itemA = await mkItem("A item");
        itemB = await mkItem("B item");

        purchaseId = (
            await prisma.purchase.create({
                data: {
                    warehouse_id: await sharedWarehouseId(),
                    purchase_date: new Date(),
                    total_amount: 10,
                    paid_amount: 10,
                    due_amount: 0,
                    recorded_by_id: profileId,
                },
            })
        ).id;
        const mkLot = async (item_id: string, unit_count: number | null) =>
            (
                await prisma.purchaseItem.create({
                    data: {
                        purchase_id: purchaseId,
                        item_id,
                        quantity: 10,
                        unit: "BOTTLE",
                        base_quantity: 10,
                        unit_price: 1,
                        total_price: 10,
                        unit_count,
                    },
                })
            ).id;
        lotA = await mkLot(itemA, 10); // 10 L in 10 bottles: 1 L each
        lotB = await mkLot(itemB, null); // never split: size unknown
    });

    afterAll(async () => {
        await prisma.stockHouseAllocation.deleteMany({ where: { id: { in: allocIds } } });
        await prisma.stockUnit.deleteMany({ where: { id: { in: unitIds } } });
        await prisma.purchaseItem.deleteMany({ where: { id: { in: [lotA, lotB] } } });
        await prisma.purchase.delete({ where: { id: purchaseId } });
        await prisma.item.deleteMany({ where: { id: { in: [itemA, itemB] } } });
        await prisma.houses.deleteMany({ where: { id: { in: [houseId, otherId] } } });
        await prisma.profiles.delete({ where: { id: profileId } });
    });

    /** A unit with a move history: each step is [house or null for a return, minutes after t0]. */
    const unit = async (
        lot: string,
        status: "IN_STOCK" | "IN_USE",
        moves: [string | null, number][],
    ) => {
        const u = await prisma.stockUnit.create({ data: { purchase_item_id: lot, status } });
        unitIds.push(u.id);
        for (const [house_id, minute] of moves) {
            const a = await prisma.stockHouseAllocation.create({
                data: {
                    stock_unit_id: u.id,
                    house_id,
                    type: house_id === null ? "RETURN" : "ALLOCATION",
                    occurred_at: new Date(t0 + minute * 1000),
                    idempotency_key: crypto.randomUUID(),
                },
            });
            allocIds.push(a.id);
        }
    };

    test("counts unused units whose latest move is into this house, per item", async () => {
        for (let i = 0; i < 3; i++) await unit(lotA, "IN_STOCK", [[houseId, 1]]); // here
        await unit(lotA, "IN_STOCK", [
            [houseId, 1],
            [otherId, 2],
        ]); //               moved on to another house
        await unit(lotA, "IN_STOCK", [
            [houseId, 1],
            [null, 2],
        ]); //                  returned to the warehouse
        await unit(lotA, "IN_USE", [[houseId, 1]]); //                               here, but already used
        await unit(lotA, "IN_STOCK", [
            [otherId, 1],
            [houseId, 2],
        ]); //               came back from another: counts
        await unit(lotA, "IN_STOCK", []); //                                         never moved: warehouse
        await unit(lotB, "IN_STOCK", [[houseId, 1]]);
        await unit(lotB, "IN_STOCK", [[houseId, 1]]);

        const stock = await HouseService.getCodedStock(houseId);
        const a = stock.find((s) => s.item_id === itemA)!;
        const b = stock.find((s) => s.item_id === itemB)!;

        expect(a).toMatchObject({ units: 4, quantity: 4, pack_unit: "BOTTLE", unit: "LITER" }); // 3 + the one that came back
        expect(b).toMatchObject({ units: 2, quantity: null }); // lot never split: size unknown, not guessed
        expect(stock.length).toBe(2);
    });

    test("a house with nothing in it returns an empty list, and an unknown house is a 404", async () => {
        const empty = await prisma.houses.create({
            data: { name: "Empty House", type: "BROODER", number: houseNumber() },
        });
        try {
            expect(await HouseService.getCodedStock(empty.id)).toEqual([]);
        } finally {
            await prisma.houses.delete({ where: { id: empty.id } });
        }
        await expect(
            HouseService.getCodedStock("00000000-0000-4000-8000-000000000000"),
        ).rejects.toMatchObject({
            status: 404,
        });
    });
});
