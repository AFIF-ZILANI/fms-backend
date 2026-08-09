import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { BatchService } from "./batch.service";
import { BirdSaleService } from "./bird-sale.service";
import { AnalyticsService } from "./analytics.service";
import { AppError } from "@lib/app-error";

let houseId: string;
let profileId: string;
let batchId: string;

describe("AnalyticsService", () => {
    beforeAll(async () => {
        const house = await prisma.houses.create({
            data: { name: "Analytics House", type: "BROODER", number: 9101 },
        });
        houseId = house.id;
        const profile = await prisma.profiles.create({
            data: {
                name: "Analytics Recorder",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "ADMIN",
            },
        });
        profileId = profile.id;

        const batch = await BatchService.create({
            batch_code: `ANALYTICS-${crypto.randomUUID()}`,
            breed: "CLASSIC",
            expected_selling_date: new Date(Date.now() + 30 * 86400_000),
            initial_chick_count: 1000,
            init_chicks_avg_wt: 40,
            house_id: houseId,
            recorded_by_id: profileId,
        });
        batchId = batch!.id;

        // 20 died -> 2% cumulative mortality
        await prisma.mortalityLog.create({
            data: {
                batch_id: batchId,
                house_id: houseId,
                count_died: 20,
                date: new Date(),
                recorded_by_id: profileId,
                idempotency_key: crypto.randomUUID(),
            },
        });
        await prisma.batchHouseBalance.update({
            where: { batch_id_house_id: { batch_id: batchId, house_id: houseId } },
            data: { quantity: { decrement: 20 } },
        });

        await prisma.weightRecords.create({
            data: {
                batch_id: batchId,
                house_id: houseId,
                average_wt_grams: 500,
                sample_size: 30,
                date: new Date(),
                measured_by_id: profileId,
                idempotency_key: crypto.randomUUID(),
            },
        });

        // direct expense of 2000 for this batch
        await prisma.expense.create({
            data: {
                batch_id: batchId,
                category: "VET_FEE",
                cost_type: "DIRECT",
                amount: 2000,
                date: new Date(),
                recorded_by_id: profileId,
            },
        });

        // sell 300 birds for a known revenue figure
        await BirdSaleService.create({
            batch_id: batchId,
            house_id: houseId,
            sale_date: new Date(),
            grade: "HIGH",
            birds_count: 300,
            dholta_in_g: 500,
            total_katha: 10,
            total_weight: 600,
            net_weight: 590,
            price_per_kg: 200,
            paid_amount: 0,
            recorded_by_id: profileId,
        });
    });

    afterAll(async () => {
        await prisma.birdSale.deleteMany({ where: { batch_id: batchId } });
        await prisma.expense.deleteMany({ where: { batch_id: batchId } });
        await prisma.weightRecords.deleteMany({ where: { batch_id: batchId } });
        await prisma.mortalityLog.deleteMany({ where: { batch_id: batchId } });
        await prisma.batchHouseBalance.deleteMany({ where: { batch_id: batchId } });
        await prisma.batchHouseAllocation.deleteMany({ where: { batch_id: batchId } });
        await prisma.batches.delete({ where: { id: batchId } });
        await prisma.houses.delete({ where: { id: houseId } });
        await prisma.profiles.delete({ where: { id: profileId } });
    });

    test("farmOverview counts this batch among active batches and live birds", async () => {
        const overview = await AnalyticsService.farmOverview();
        expect(overview.active_batch_count).toBeGreaterThanOrEqual(1);
        expect(overview.total_birds_alive).toBeGreaterThanOrEqual(680); // 1000 - 20 died - 300 sold
    });

    test("batchPerformance computes cumulative mortality rate and live count", async () => {
        const performance = await AnalyticsService.batchPerformance(batchId);
        expect(performance.live_count).toBe(680); // 1000 - 20 - 300
        expect(performance.cumulative_died).toBe(20);
        expect(performance.cumulative_mortality_rate).toBeCloseTo(0.02, 4);
        expect(performance.latest_average_weight_grams?.toNumber()).toBe(500);
    });

    test("batchPerformance on unknown batch throws not-found", async () => {
        await expect(
            AnalyticsService.batchPerformance("00000000-0000-0000-0000-000000000000"),
        ).rejects.toBeInstanceOf(AppError);
    });

    test("batchPnl computes revenue - direct expenses, revenue = 590 * 200 = 118000", async () => {
        const pnl = await AnalyticsService.batchPnl(batchId);
        expect(pnl.revenue.toNumber()).toBe(118000);
        expect(pnl.direct_expenses.toNumber()).toBe(2000);
        expect(pnl.profit.toNumber()).toBe(118000 - 2000); // no purchase cost or depreciation in this scenario
    });

    test("financialDashboard includes this batch's bird sale revenue and expense for the current month", async () => {
        const dashboard = await AnalyticsService.financialDashboard({});
        expect(dashboard.revenue.toNumber()).toBeGreaterThanOrEqual(118000);
        expect(dashboard.expenses.toNumber()).toBeGreaterThanOrEqual(2000);
    });

    test("mortalityTrend includes today's seeded 20 deaths within the default window", async () => {
        const trend = await AnalyticsService.mortalityTrend(30);
        const today = new Date().toISOString().slice(0, 10);
        const todayRow = trend.find((r) => r.date === today);
        expect(todayRow).toBeDefined();
        expect(todayRow!.died).toBeGreaterThanOrEqual(20);
    });
});
