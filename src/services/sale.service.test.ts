import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { SaleService } from "./sale.service";
import { AppError } from "@lib/app-error";

let itemId: string;
let profileId: string;
const createdSaleIds: string[] = [];

describe("SaleService", () => {
    beforeAll(async () => {
        const item = await prisma.item.create({
            data: {
                name: `Sale Item ${crypto.randomUUID()}`,
                normalized_key: `sale item ${crypto.randomUUID()}`,
                category: "OTHER",
                unit: "BAG",
            },
        });
        itemId = item.id;
        const profile = await prisma.profiles.create({
            data: {
                name: "Sale Recorder",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "ADMIN",
            },
        });
        profileId = profile.id;
    });

    afterAll(async () => {
        await prisma.saleItem.deleteMany({ where: { sale_id: { in: createdSaleIds } } });
        await prisma.sale.deleteMany({ where: { id: { in: createdSaleIds } } });
        await prisma.item.delete({ where: { id: itemId } });
        await prisma.profiles.delete({ where: { id: profileId } });
    });

    test("create computes line totals and sale total with exact decimal math", async () => {
        const sale = await SaleService.create({
            sale_date: new Date(),
            paid_amount: 50,
            recorded_by_id: profileId,
            items: [
                { item_id: itemId, quantity: 4, unit: "BAG", unit_price: 12.25 },
                { item_id: itemId, quantity: 2, unit: "BAG", unit_price: 8.5 },
            ],
        });
        createdSaleIds.push(sale!.id);

        // 4 * 12.25 = 49.00, 2 * 8.50 = 17.00, total = 66.00
        expect(sale!.total.toNumber()).toBeCloseTo(66.0, 2);
        expect(sale!.due_amount.toNumber()).toBeCloseTo(16.0, 2);
    });

    test("paid_amount exceeding total throws bad-request", async () => {
        await expect(
            SaleService.create({
                sale_date: new Date(),
                paid_amount: 9999,
                recorded_by_id: profileId,
                items: [{ item_id: itemId, quantity: 1, unit: "BAG", unit_price: 5 }],
            }),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("getById on unknown id throws not-found", async () => {
        await expect(
            SaleService.getById("00000000-0000-0000-0000-000000000000"),
        ).rejects.toBeInstanceOf(AppError);
    });
});
