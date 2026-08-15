import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { BatchService } from "./batch.service";
import { BirdSaleService } from "./bird-sale.service";
import { AnalyticsService } from "./analytics.service";
import { AppError } from "@lib/app-error";

let houseId: string;
let profileId: string;
let batchId: string;
let feedItemId: string;
let saleId: string;

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

        // a plain Sale (no line items needed at the DB level) with a known partial payment,
        // so outstanding_receivables coverage isn't limited to the BirdSale half of the aggregate
        const sale = await prisma.sale.create({
            data: {
                sale_date: new Date(),
                total: 500,
                paid_amount: 200,
                due_amount: 300,
                recorded_by_id: profileId,
            },
        });
        saleId = sale.id;

        const feedItem = await prisma.item.create({
            data: {
                name: `Analytics Feed ${crypto.randomUUID()}`,
                normalized_key: `analytics-feed-${crypto.randomUUID()}`,
                category: "FEED",
                unit: "BAG",
            },
        });
        feedItemId = feedItem.id;
        await prisma.consumption.create({
            data: {
                batch_id: batchId,
                house_id: houseId,
                item_id: feedItemId,
                quantity: 5,
                date: new Date(),
                recorded_by_id: profileId,
                idempotency_key: crypto.randomUUID(),
            },
        });
    });

    afterAll(async () => {
        await prisma.sale.delete({ where: { id: saleId } });
        await prisma.consumption.deleteMany({ where: { item_id: feedItemId } });
        await prisma.item.delete({ where: { id: feedItemId } });
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

    test("batchesPerformance('RUNNING') includes this batch with the same numbers as the single-batch endpoint", async () => {
        const rows = await AnalyticsService.batchesPerformance("RUNNING");
        const row = rows.find((r) => r.batch_id === batchId);
        expect(row).toBeDefined();
        expect(row!.live_count).toBe(680);
        expect(row!.cumulative_died).toBe(20);
        expect(row!.cumulative_mortality_rate).toBeCloseTo(0.02, 4);
        expect(row!.latest_average_weight_grams?.toNumber()).toBe(500);
    });

    test("batchesPerformance with no status filter includes batches of any status", async () => {
        const rows = await AnalyticsService.batchesPerformance(undefined);
        expect(rows.some((r) => r.batch_id === batchId)).toBe(true);
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
        expect(dashboard.revenue.toNumber()).toBeGreaterThanOrEqual(118000 + 500);
        expect(dashboard.expenses.toNumber()).toBeGreaterThanOrEqual(2000);
        // outstanding_receivables = Sale.due_amount sum + BirdSale.due_amount sum -- assert the combined
        // total, not just the BirdSale half, so a deleted Sale aggregate would fail this test
        expect(dashboard.outstanding_receivables.toNumber()).toBeGreaterThanOrEqual(118000 + 300);
    });

    test("mortalityTrend includes today's seeded 20 deaths within the default window", async () => {
        const trend = await AnalyticsService.mortalityTrend(30);
        const today = new Date().toISOString().slice(0, 10);
        const todayRow = trend.find((r) => r.date === today);
        expect(todayRow).toBeDefined();
        expect(todayRow!.died).toBeGreaterThanOrEqual(20);
    });

    test("mortalityTrend sums same-day logs at different times into one entry", async () => {
        const afternoon = new Date();
        afternoon.setHours(14, 0, 0, 0);

        const extraLog = await prisma.mortalityLog.create({
            data: {
                batch_id: batchId,
                house_id: houseId,
                count_died: 3,
                date: afternoon,
                recorded_by_id: profileId,
                idempotency_key: crypto.randomUUID(),
            },
        });

        try {
            const trend = await AnalyticsService.mortalityTrend(30);
            const today = new Date().toISOString().slice(0, 10);
            const todayRows = trend.filter((r) => r.date === today);
            expect(todayRows.length).toBe(1);
            expect(todayRows[0]!.died).toBeGreaterThanOrEqual(23); // 20 from beforeAll's seed + 3 from this test
        } finally {
            await prisma.mortalityLog.delete({ where: { id: extraLog.id } });
        }
    });

    test("feedTrend groups today's 5-BAG consumption by date and unit", async () => {
        const trend = await AnalyticsService.feedTrend(30);
        const today = new Date().toISOString().slice(0, 10);
        const todayBagRow = trend.find((r) => r.date === today && r.unit === "BAG");
        expect(todayBagRow).toBeDefined();
        expect(parseFloat(todayBagRow!.quantity)).toBeGreaterThanOrEqual(5);
    });

    test("salesTrend reports today's revenue and volume-weighted avg price", async () => {
        const trend = await AnalyticsService.salesTrend(30);
        const today = new Date().toISOString().slice(0, 10);
        const todayRow = trend.find((r) => r.date === today);
        expect(todayRow).toBeDefined();
        expect(parseFloat(todayRow!.revenue)).toBeGreaterThanOrEqual(118000);
        expect(parseFloat(todayRow!.avg_price_per_kg)).toBeCloseTo(200, 0);
    });

    test("expenseBreakdown groups the seeded VET_FEE expense by category for the current month", async () => {
        const breakdown = await AnalyticsService.expenseBreakdown();
        const vetFeeRow = breakdown.find((r) => r.category === "VET_FEE");
        expect(vetFeeRow).toBeDefined();
        expect(parseFloat(vetFeeRow!.total)).toBeGreaterThanOrEqual(2000);
    });

    test("revenueVsExpenses' current month includes the seeded bird-sale revenue and expense", async () => {
        const rows = await AnalyticsService.revenueVsExpenses(6);
        const thisMonth = new Date().toISOString().slice(0, 7);
        const currentRow = rows.find((r) => r.month === thisMonth);
        expect(currentRow).toBeDefined();
        expect(parseFloat(currentRow!.revenue)).toBeGreaterThanOrEqual(118000);
        expect(parseFloat(currentRow!.expenses)).toBeGreaterThanOrEqual(2000);
    });

    test("salesByProductLine folds BirdSale revenue into a BIRD entry and buckets SaleItem revenue by Item.category", async () => {
        const wasteItem = await prisma.item.create({
            data: {
                name: `Manure ${crypto.randomUUID()}`,
                normalized_key: `manure-${crypto.randomUUID()}`,
                category: "WASTE",
                unit: "BAG",
            },
        });
        const wasteSale = await prisma.sale.create({
            data: { sale_date: new Date(), total: 300, paid_amount: 0, due_amount: 300, recorded_by_id: profileId },
        });
        await prisma.saleItem.create({
            data: {
                sale_id: wasteSale.id,
                item_id: wasteItem.id,
                quantity: 10,
                unit: "BAG",
                unit_price: 30,
                total_price: 300,
            },
        });

        try {
            const rows = await AnalyticsService.salesByProductLine(30);
            const birdRow = rows.find((r) => r.category === "BIRD");
            const wasteRow = rows.find((r) => r.category === "WASTE");
            expect(birdRow).toBeDefined();
            expect(parseFloat(birdRow!.revenue)).toBeGreaterThanOrEqual(118000);
            expect(wasteRow).toBeDefined();
            expect(parseFloat(wasteRow!.revenue)).toBeGreaterThanOrEqual(300);
        } finally {
            await prisma.saleItem.deleteMany({ where: { sale_id: wasteSale.id } });
            await prisma.sale.delete({ where: { id: wasteSale.id } });
            await prisma.item.delete({ where: { id: wasteItem.id } });
        }
    });

    test("birdGradeDistribution groups today's seeded HIGH-grade sale", async () => {
        const rows = await AnalyticsService.birdGradeDistribution(30);
        const highRow = rows.find((r) => r.grade === "HIGH");
        expect(highRow).toBeDefined();
        expect(highRow!.birds_count).toBeGreaterThanOrEqual(300);
        expect(parseFloat(highRow!.revenue)).toBeGreaterThanOrEqual(118000);
    });

    test("purchasesByCategory buckets PurchaseItem cost by Item.category", async () => {
        const item = await prisma.item.create({
            data: {
                name: `Analytics Purchase Item ${crypto.randomUUID()}`,
                normalized_key: `analytics-purchase-item-${crypto.randomUUID()}`,
                category: "EQUIPMENT",
                unit: "UNIT",
            },
        });
        const supplierProfile = await prisma.profiles.create({
            data: {
                name: "Analytics Supplier",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "SUPPLIER",
            },
        });
        const supplier = await prisma.suppliers.create({
            data: { profile_id: supplierProfile.id, role: "DISTRIBUTOR", supplies: ["EQUIPMENT"] },
        });
        const purchase = await prisma.purchase.create({
            data: {
                supplier_id: supplier.id,
                purchase_date: new Date(),
                total_amount: 500,
                paid_amount: 0,
                due_amount: 500,
                recorded_by_id: profileId,
            },
        });
        await prisma.purchaseItem.create({
            data: {
                purchase_id: purchase.id,
                item_id: item.id,
                quantity: 5,
                unit: "UNIT",
                unit_price: 100,
                total_price: 500,
            },
        });

        try {
            const rows = await AnalyticsService.purchasesByCategory(30);
            const equipmentRow = rows.find((r) => r.category === "EQUIPMENT");
            expect(equipmentRow).toBeDefined();
            expect(parseFloat(equipmentRow!.total)).toBeGreaterThanOrEqual(500);
        } finally {
            await prisma.purchaseItem.deleteMany({ where: { purchase_id: purchase.id } });
            await prisma.purchase.delete({ where: { id: purchase.id } });
            await prisma.item.delete({ where: { id: item.id } });
            await prisma.suppliers.delete({ where: { id: supplier.id } });
            await prisma.profiles.delete({ where: { id: supplierProfile.id } });
        }
    });
});
