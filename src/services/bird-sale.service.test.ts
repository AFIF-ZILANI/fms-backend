import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { BatchService } from "./batch.service";
import { BirdSaleService } from "./bird-sale.service";
import { createBirdSaleSchema } from "@validators/bird-sale.validator";

let houseId: string;
let profileId: string;
const createdBatchIds: string[] = [];
const createdSaleIds: string[] = [];

const batchCode = () => `BS-${crypto.randomUUID()}`;

async function newRunningBatch(count: number) {
    const batch = await BatchService.create({
        batch_code: batchCode(),
        breed: "CLASSIC",
        expected_selling_date: new Date(Date.now() + 30 * 86400_000),
        initial_chick_count: count,
        init_chicks_avg_wt: 40,
        house_id: houseId,
        recorded_by_id: profileId,
    });
    createdBatchIds.push(batch!.id);
    return batch!;
}

describe("BirdSaleService", () => {
    beforeAll(async () => {
        const house = await prisma.houses.create({
            data: { name: "BirdSale House", type: "GROWER", number: 801 },
        });
        houseId = house.id;
        const profile = await prisma.profiles.create({
            data: {
                name: "BirdSale Recorder",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "ADMIN",
            },
        });
        profileId = profile.id;
    });

    afterAll(async () => {
        await prisma.birdSale.deleteMany({ where: { id: { in: createdSaleIds } } });
        await prisma.batchHouseBalance.deleteMany({ where: { batch_id: { in: createdBatchIds } } });
        await prisma.batchHouseAllocation.deleteMany({
            where: { batch_id: { in: createdBatchIds } },
        });
        await prisma.batches.deleteMany({ where: { id: { in: createdBatchIds } } });
        await prisma.houses.delete({ where: { id: houseId } });
        await prisma.profiles.delete({ where: { id: profileId } });
    });

    test("create decrements BatchHouseBalance and computes total_amount = net_weight * price_per_kg", async () => {
        const batch = await newRunningBatch(1000);

        const sale = await BirdSaleService.create({
            batch_id: batch.id,
            house_id: houseId,
            sale_date: new Date(),
            grade: "HIGH",
            birds_count: 200,
            dholta_in_g: 500,
            total_katha: 10,
            total_weight: 400,
            net_weight: 395.5,
            price_per_kg: 150,
            paid_amount: 0,
            recorded_by_id: profileId,
        });
        createdSaleIds.push(sale!.id);

        expect(sale!.total_amount.toNumber()).toBeCloseTo(395.5 * 150, 2);
        expect(sale!.due_amount.toNumber()).toBeCloseTo(395.5 * 150, 2);

        const balance = await prisma.batchHouseBalance.findUnique({
            where: { batch_id_house_id: { batch_id: batch.id, house_id: houseId } },
        });
        expect(balance?.quantity).toBe(800);
    });

    test("selling more birds than the house balance throws a conflict and doesn't write a row", async () => {
        const batch = await newRunningBatch(50);

        await expect(
            BirdSaleService.create({
                batch_id: batch.id,
                house_id: houseId,
                sale_date: new Date(),
                grade: "LOW",
                birds_count: 500,
                dholta_in_g: 100,
                total_katha: 5,
                total_weight: 100,
                net_weight: 98,
                price_per_kg: 140,
                paid_amount: 0,
                recorded_by_id: profileId,
            }),
        ).rejects.toMatchObject({ status: 409 });

        const saleCount = await prisma.birdSale.count({ where: { batch_id: batch.id } });
        expect(saleCount).toBe(0);
        const balance = await prisma.batchHouseBalance.findUnique({
            where: { batch_id_house_id: { batch_id: batch.id, house_id: houseId } },
        });
        expect(balance?.quantity).toBe(50);
    });

    test("mismatched male_count + female_count vs birds_count is rejected by the validator", () => {
        const result = createBirdSaleSchema.safeParse({
            batch_id: crypto.randomUUID(),
            house_id: crypto.randomUUID(),
            sale_date: new Date().toISOString(),
            grade: "HIGH",
            male_count: 10,
            female_count: 10,
            birds_count: 25,
            dholta_in_g: 100,
            total_katha: 5,
            total_weight: 100,
            net_weight: 98,
            price_per_kg: 140,
            recorded_by_id: crypto.randomUUID(),
        });
        expect(result.success).toBe(false);
    });

    test("paid_amount exceeding computed total_amount throws bad-request", async () => {
        const batch = await newRunningBatch(100);

        await expect(
            BirdSaleService.create({
                batch_id: batch.id,
                house_id: houseId,
                sale_date: new Date(),
                grade: "CULL",
                birds_count: 10,
                dholta_in_g: 50,
                total_katha: 2,
                total_weight: 20,
                net_weight: 19,
                price_per_kg: 100,
                paid_amount: 99999,
                recorded_by_id: profileId,
            }),
        ).rejects.toMatchObject({ status: 400 });
    });
});
