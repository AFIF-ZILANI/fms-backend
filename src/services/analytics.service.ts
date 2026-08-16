import prisma from "@lib/db";
import { Prisma } from "../../prisma/generated/prisma/client";
import { AppError } from "@lib/app-error";
import { getItemBalances } from "@lib/stock-balance";
import { getItemAvgCosts } from "@lib/stock-value";
import { PaymentInstrumentService } from "@services/payment-instrument.service";
import type { FinancialDashboardQuery } from "@validators/analytics.validator";

// Reporting is deliberately read-only against every other module's tables
// (system-design-arc.md §3) -- no state of its own, only queries.
// See docs/analytics-dashboard-design.md for the full aggregate-endpoint design.
export const AnalyticsService = {
    async farmOverview() {
        const [activeBatchCount, totalBirdsAlive, houses, employeeCount, alertsByLevel] =
            await Promise.all([
                prisma.batches.count({ where: { status: "RUNNING" } }),
                prisma.batchHouseBalance.aggregate({
                    where: { batch: { status: "RUNNING" } },
                    _sum: { quantity: true },
                }),
                prisma.houses.findMany({
                    where: { is_active: true },
                    include: { batchHouseBalances: true },
                }),
                prisma.employees.count({ where: { profile: { is_active: true } } }),
                prisma.alerts.groupBy({
                    by: ["level"],
                    where: { status: "ACTIVE" },
                    _count: { _all: true },
                }),
            ]);

        const housesOccupied = houses.filter((h) =>
            h.batchHouseBalances.some((b) => b.quantity > 0),
        ).length;

        return {
            active_batch_count: activeBatchCount,
            total_birds_alive: totalBirdsAlive._sum.quantity ?? 0,
            houses_occupied: housesOccupied,
            houses_empty: houses.length - housesOccupied,
            employee_headcount: employeeCount,
            unresolved_alerts_by_level: Object.fromEntries(
                alertsByLevel.map((a) => [a.level, a._count._all]),
            ),
        };
    },

    /** FCR is deliberately not computed here -- feed quantities are logged
     * in whatever Unit the item uses (BAG, KG, ...) and converting that to
     * a true feed-conversion ratio needs a per-unit weight table this
     * system doesn't have yet. Exposing a computed ratio built on an
     * unstated unit assumption would be worse than not having one -- same
     * reasoning as leaving BirdSale's dholta/katha fields alone in Phase 9. */
    async batchPerformance(batchId: string) {
        const batch = await prisma.batches.findUnique({
            where: { id: batchId },
            include: { houseBalances: true },
        });
        if (!batch) throw AppError.notFound("Batch");

        const liveCount = batch.houseBalances.reduce((sum, b) => sum + b.quantity, 0);
        const totalDied = await prisma.mortalityLog.aggregate({
            where: { batch_id: batchId },
            _sum: { count_died: true },
        });
        const died = totalDied._sum.count_died ?? 0;
        const latestWeight = await prisma.weightRecords.findFirst({
            where: { batch_id: batchId },
            orderBy: { date: "desc" },
        });

        return {
            batch_id: batchId,
            live_count: liveCount,
            initial_chick_count: batch.initial_chick_count,
            cumulative_died: died,
            cumulative_mortality_rate:
                batch.initial_chick_count > 0 ? died / batch.initial_chick_count : 0,
            age_days: Math.floor((Date.now() - batch.starting_date.getTime()) / 86_400_000),
            expected_selling_date: batch.expected_selling_date,
            actual_end_date: batch.actual_end_date,
            latest_average_weight_grams: latestWeight?.average_wt_grams ?? null,
            latest_weight_date: latestWeight?.date ?? null,
        };
    },

    /** Bulk version of batchPerformance -- one query set for every matching
     * batch instead of one request per batch. Powers both the batch
     * comparison chart and the Analytics page's performance table. */
    async batchesPerformance(status?: "RUNNING" | "CLOSED" | "SOLD") {
        const batches = await prisma.batches.findMany({
            where: status !== undefined ? { status } : {},
            include: { houseBalances: true },
        });
        const batchIds = batches.map((b) => b.id);

        const [mortalityByBatch, weightRecords] = await Promise.all([
            prisma.mortalityLog.groupBy({
                by: ["batch_id"],
                where: { batch_id: { in: batchIds } },
                _sum: { count_died: true },
            }),
            prisma.weightRecords.findMany({
                where: { batch_id: { in: batchIds } },
                orderBy: { date: "desc" },
            }),
        ]);

        const diedByBatch = new Map(mortalityByBatch.map((m) => [m.batch_id, m._sum.count_died ?? 0]));
        const latestWeightByBatch = new Map<string, (typeof weightRecords)[number]>();
        for (const record of weightRecords) {
            if (record.batch_id && !latestWeightByBatch.has(record.batch_id)) {
                latestWeightByBatch.set(record.batch_id, record);
            }
        }

        return batches.map((batch) => {
            const liveCount = batch.houseBalances.reduce((sum, b) => sum + b.quantity, 0);
            const died = diedByBatch.get(batch.id) ?? 0;
            const latestWeight = latestWeightByBatch.get(batch.id);
            return {
                batch_id: batch.id,
                live_count: liveCount,
                initial_chick_count: batch.initial_chick_count,
                cumulative_died: died,
                cumulative_mortality_rate: batch.initial_chick_count > 0 ? died / batch.initial_chick_count : 0,
                age_days: Math.floor((Date.now() - batch.starting_date.getTime()) / 86_400_000),
                expected_selling_date: batch.expected_selling_date,
                actual_end_date: batch.actual_end_date,
                latest_average_weight_grams: latestWeight?.average_wt_grams ?? null,
                latest_weight_date: latestWeight?.date ?? null,
            };
        });
    },

    /** revenue - purchase cost (chicks, batch-linked) - direct expenses -
     * depreciation share. Shared-period costs stay unallocated -- the
     * bird-days formula that would distribute them is explicitly v2
     * (system-design-arc.md §7), not guessed at here. */
    async batchPnl(batchId: string) {
        const batch = await prisma.batches.findUnique({ where: { id: batchId } });
        if (!batch) throw AppError.notFound("Batch");

        const [birdSaleRevenue, purchaseCost, directExpenses, sharedPeriodExpenses, depreciation] =
            await Promise.all([
                prisma.birdSale.aggregate({
                    where: { batch_id: batchId },
                    _sum: { total_amount: true },
                }),
                prisma.purchaseItem.aggregate({
                    where: { batch_id: batchId },
                    _sum: { total_price: true },
                }),
                prisma.expense.aggregate({
                    where: { batch_id: batchId, cost_type: "DIRECT" },
                    _sum: { amount: true },
                }),
                prisma.expense.aggregate({
                    where: { batch_id: batchId, cost_type: "SHARED_PERIOD" },
                    _sum: { amount: true },
                }),
                prisma.assetDepreciation.aggregate({
                    where: { batch_id: batchId },
                    _sum: { amount: true },
                }),
            ]);

        const revenue = birdSaleRevenue._sum.total_amount ?? new Prisma.Decimal(0);
        const purchase_cost = purchaseCost._sum.total_price ?? new Prisma.Decimal(0);
        const direct_expenses = directExpenses._sum.amount ?? new Prisma.Decimal(0);
        const depreciation_share = depreciation._sum.amount ?? new Prisma.Decimal(0);
        const shared_period_expenses_unallocated =
            sharedPeriodExpenses._sum.amount ?? new Prisma.Decimal(0);

        const profit = revenue
            .minus(purchase_cost)
            .minus(direct_expenses)
            .minus(depreciation_share);

        return {
            batch_id: batchId,
            revenue,
            purchase_cost,
            direct_expenses,
            depreciation_share,
            shared_period_expenses_unallocated,
            profit,
        };
    },

    async financialDashboard(query: FinancialDashboardQuery) {
        const month = query.month ?? new Date();
        const monthStart = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
        const monthEnd = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));

        const [saleRevenue, birdSaleRevenue, expenses, purchasesDue, salesDue, birdSalesDue, instruments] =
            await Promise.all([
                prisma.sale.aggregate({
                    where: { sale_date: { gte: monthStart, lt: monthEnd } },
                    _sum: { total: true },
                }),
                prisma.birdSale.aggregate({
                    where: { sale_date: { gte: monthStart, lt: monthEnd } },
                    _sum: { total_amount: true },
                }),
                prisma.expense.aggregate({
                    where: { date: { gte: monthStart, lt: monthEnd } },
                    _sum: { amount: true },
                }),
                prisma.purchase.aggregate({ _sum: { due_amount: true } }),
                prisma.sale.aggregate({ _sum: { due_amount: true } }),
                prisma.birdSale.aggregate({ _sum: { due_amount: true } }),
                prisma.paymentInstrument.findMany({ where: { is_active: true } }),
            ]);

        const revenue = (saleRevenue._sum.total ?? new Prisma.Decimal(0)).plus(
            birdSaleRevenue._sum.total_amount ?? new Prisma.Decimal(0),
        );
        const expenseTotal = expenses._sum.amount ?? new Prisma.Decimal(0);
        const outstandingReceivables = (salesDue._sum.due_amount ?? new Prisma.Decimal(0)).plus(
            birdSalesDue._sum.due_amount ?? new Prisma.Decimal(0),
        ); // raw Prisma.Decimal, not .toString()'d -- matches every sibling

        const balances = await Promise.all(
            instruments.map((inst) => PaymentInstrumentService.getBalance(inst.id)),
        );
        const cashPosition = balances.reduce(
            (sum, b) => sum.plus(b.balance),
            new Prisma.Decimal(0),
        );

        return {
            month: monthStart.toISOString().slice(0, 7),
            revenue,
            expenses: expenseTotal,
            gross_profit: revenue.minus(expenseTotal),
            outstanding_payables: purchasesDue._sum.due_amount ?? new Prisma.Decimal(0),
            outstanding_receivables: outstandingReceivables,
            cash_position: cashPosition,
            cash_by_instrument: instruments.map((inst, i) => ({
                instrument_id: inst.id,
                label: inst.label,
                balance: balances[i]!.balance,
            })),
        };
    },

    /** Daily death count across every batch, last `days` days. No zero-fill
     * for days with no logs — the chart fills gaps client-side, this stays
     * a straight aggregation. Groups by calendar day (YYYY-MM-DD), not by
     * raw DateTime; same-day logs at different times are summed into one entry. */
    async mortalityTrend(days: number) {
        const since = new Date(Date.now() - days * 86_400_000);
        since.setUTCHours(0, 0, 0, 0);
        const rows = await prisma.mortalityLog.findMany({
            where: { date: { gte: since, lte: new Date() } },
            select: { date: true, count_died: true },
        });

        const byDate = new Map<string, number>();
        for (const row of rows) {
            const dateKey = row.date.toISOString().slice(0, 10);
            byDate.set(dateKey, (byDate.get(dateKey) ?? 0) + row.count_died);
        }

        return Array.from(byDate.entries())
            .map(([date, died]) => ({ date, died }))
            .sort((a, b) => a.date.localeCompare(b.date));
    },

    /** Daily FEED-category consumption, grouped by date AND unit -- quantities
     * in different units (BAG vs KG) must never be summed together, same
     * reasoning as the FCR gap noted on batchPerformance. A raw groupBy can't
     * reach through the item relation for unit, so this groups in memory. */
    async feedTrend(days: number) {
        const since = new Date(Date.now() - days * 86_400_000);
        since.setUTCHours(0, 0, 0, 0);
        const rows = await prisma.consumption.findMany({
            where: { date: { gte: since, lte: new Date() }, item: { category: "FEED" } },
            select: { date: true, quantity: true, item: { select: { unit: true } } },
        });

        const byKey = new Map<string, Prisma.Decimal>();
        for (const row of rows) {
            const dateKey = row.date.toISOString().slice(0, 10);
            const key = `${dateKey}|${row.item.unit}`;
            byKey.set(key, (byKey.get(key) ?? new Prisma.Decimal(0)).plus(row.quantity));
        }

        return Array.from(byKey.entries())
            .map(([key, quantity]) => {
                const [date, unit] = key.split("|") as [string, string];
                return { date, unit, quantity: quantity.toString() };
            })
            .sort((a, b) => a.date.localeCompare(b.date));
    },

    /** Daily bird-sale revenue and volume-weighted avg price/kg (total
     * revenue / total net weight for the day, not an average of averages --
     * a 10kg sale and a 500kg sale don't count equally). Buckets in memory
     * by calendar day rather than a raw groupBy: `sale_date` is a
     * full-precision DateTime, so a Prisma groupBy on it treats two sales on
     * the same day at different times as separate groups instead of one --
     * same trap `mortalityTrend` (Task 1) hit and fixed the same way. */
    async salesTrend(days: number) {
        const since = new Date(Date.now() - days * 86_400_000);
        since.setUTCHours(0, 0, 0, 0);
        const rows = await prisma.birdSale.findMany({
            where: { sale_date: { gte: since, lte: new Date() } },
            select: { sale_date: true, total_amount: true, net_weight: true },
        });

        const byDate = new Map<string, { revenue: Prisma.Decimal; weight: Prisma.Decimal }>();
        for (const row of rows) {
            const dateKey = row.sale_date.toISOString().slice(0, 10);
            const existing = byDate.get(dateKey) ?? { revenue: new Prisma.Decimal(0), weight: new Prisma.Decimal(0) };
            byDate.set(dateKey, {
                revenue: existing.revenue.plus(row.total_amount),
                weight: existing.weight.plus(row.net_weight),
            });
        }

        return Array.from(byDate.entries())
            .map(([date, { revenue, weight }]) => ({
                date,
                revenue: revenue.toString(),
                avg_price_per_kg: (weight.isZero() ? new Prisma.Decimal(0) : revenue.div(weight)).toString(),
            }))
            .sort((a, b) => a.date.localeCompare(b.date));
    },

    /** Revenue per product line over `days` days -- Regular Sale line-item
     * revenue grouped by Item.category, plus total BirdSale revenue folded
     * in as its own "BIRD" entry (BirdSale has no Item/category of its own). */
    async salesByProductLine(days: number) {
        const since = new Date(Date.now() - days * 86_400_000);
        since.setUTCHours(0, 0, 0, 0);

        const [saleItems, birdSaleRevenue] = await Promise.all([
            prisma.saleItem.findMany({
                where: { sale: { sale_date: { gte: since, lte: new Date() } } },
                select: { total_price: true, item: { select: { category: true } } },
            }),
            prisma.birdSale.aggregate({
                where: { sale_date: { gte: since, lte: new Date() } },
                _sum: { total_amount: true },
            }),
        ]);

        const byCategory = new Map<string, Prisma.Decimal>();
        for (const row of saleItems) {
            const category = row.item.category;
            byCategory.set(category, (byCategory.get(category) ?? new Prisma.Decimal(0)).plus(row.total_price));
        }
        const birdRevenue = birdSaleRevenue._sum.total_amount ?? new Prisma.Decimal(0);
        if (!birdRevenue.isZero()) {
            byCategory.set("BIRD", (byCategory.get("BIRD") ?? new Prisma.Decimal(0)).plus(birdRevenue));
        }

        return Array.from(byCategory.entries())
            .map(([category, revenue]) => ({ category, revenue: revenue.toString() }))
            .sort((a, b) => parseFloat(b.revenue) - parseFloat(a.revenue));
    },

    /** Bird count and revenue per grade over `days` days. Safe to `groupBy`
     * directly on `grade` (unlike salesTrend/mortalityTrend) -- `sale_date`
     * is only used to filter the range here, not as a groupBy key, so the
     * DateTime-precision trap those two work around doesn't apply. */
    async birdGradeDistribution(days: number) {
        const since = new Date(Date.now() - days * 86_400_000);
        since.setUTCHours(0, 0, 0, 0);

        const grouped = await prisma.birdSale.groupBy({
            by: ["grade"],
            where: { sale_date: { gte: since, lte: new Date() } },
            _sum: { birds_count: true, total_amount: true },
        });

        return grouped
            .map((row) => ({
                grade: row.grade,
                birds_count: row._sum.birds_count ?? 0,
                revenue: (row._sum.total_amount ?? new Prisma.Decimal(0)).toString(),
            }))
            .sort((a, b) => b.birds_count - a.birds_count);
    },

    async expenseBreakdown(month?: Date) {
        const resolvedMonth = month ?? new Date();
        const monthStart = new Date(Date.UTC(resolvedMonth.getUTCFullYear(), resolvedMonth.getUTCMonth(), 1));
        const monthEnd = new Date(Date.UTC(resolvedMonth.getUTCFullYear(), resolvedMonth.getUTCMonth() + 1, 1));

        const grouped = await prisma.expense.groupBy({
            by: ["category"],
            where: { date: { gte: monthStart, lt: monthEnd } },
            _sum: { amount: true },
        });

        return grouped
            .map((row) => ({
                category: row.category,
                total: (row._sum.amount ?? new Prisma.Decimal(0)).toString(),
            }))
            .sort((a, b) => parseFloat(b.total) - parseFloat(a.total));
    },

    async revenueVsExpenses(months: number) {
        const now = new Date();
        const windows = Array.from({ length: months }, (_, i) => {
            const monthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
            const monthStart = monthDate;
            const monthEnd = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 1));
            return { label: monthStart.toISOString().slice(0, 7), monthStart, monthEnd };
        });

        const rows = await Promise.all(
            windows.map(async ({ label, monthStart, monthEnd }) => {
                const [saleRevenue, birdSaleRevenue, expenses] = await Promise.all([
                    prisma.sale.aggregate({
                        where: { sale_date: { gte: monthStart, lt: monthEnd } },
                        _sum: { total: true },
                    }),
                    prisma.birdSale.aggregate({
                        where: { sale_date: { gte: monthStart, lt: monthEnd } },
                        _sum: { total_amount: true },
                    }),
                    prisma.expense.aggregate({
                        where: { date: { gte: monthStart, lt: monthEnd } },
                        _sum: { amount: true },
                    }),
                ]);
                const revenue = (saleRevenue._sum.total ?? new Prisma.Decimal(0)).plus(
                    birdSaleRevenue._sum.total_amount ?? new Prisma.Decimal(0),
                );
                return {
                    month: label,
                    revenue: revenue.toString(),
                    expenses: (expenses._sum.amount ?? new Prisma.Decimal(0)).toString(),
                };
            }),
        );

        return rows.sort((a, b) => a.month.localeCompare(b.month));
    },

    /** Current on-hand value per category -- balance (StockLedger IN-OUT,
     * via getItemBalances) x avg purchase cost (getItemAvgCosts). Items with
     * no purchase history contribute nothing (unknown cost, not free). */
    async stockValueByCategory() {
        const items = await prisma.item.findMany({
            where: { is_active: true },
            select: { id: true, category: true },
        });
        const itemIds = items.map((i) => i.id);
        const [balances, avgCosts] = await Promise.all([getItemBalances(itemIds), getItemAvgCosts(itemIds)]);

        const byCategory = new Map<string, Prisma.Decimal>();
        for (const item of items) {
            const balance = balances.get(item.id) ?? new Prisma.Decimal(0);
            const avgCost = avgCosts.get(item.id);
            if (!avgCost || balance.lessThanOrEqualTo(0)) continue;
            const value = balance.times(avgCost);
            byCategory.set(item.category, (byCategory.get(item.category) ?? new Prisma.Decimal(0)).plus(value));
        }

        return Array.from(byCategory.entries())
            .map(([category, total]) => ({ category, total: total.toString() }))
            .sort((a, b) => parseFloat(b.total) - parseFloat(a.total));
    },

    /** Daily IN vs OUT stock *value* over `days` days -- not raw quantity,
     * which can't be summed across items with different units (BAG vs KG),
     * same trap feedTrend's own comment flags. Both directions valued at the
     * same avg purchase cost per item (moving-average costing). */
    async stockMovementTrend(days: number) {
        const since = new Date(Date.now() - days * 86_400_000);
        since.setUTCHours(0, 0, 0, 0);
        const rows = await prisma.stockLedger.findMany({
            where: { occurred_at: { gte: since, lte: new Date() } },
            select: { item_id: true, quantity: true, direction: true, occurred_at: true },
        });
        const avgCosts = await getItemAvgCosts(Array.from(new Set(rows.map((r) => r.item_id))));

        const byDate = new Map<string, { in: Prisma.Decimal; out: Prisma.Decimal }>();
        for (const row of rows) {
            const dateKey = row.occurred_at.toISOString().slice(0, 10);
            const value = row.quantity.times(avgCosts.get(row.item_id) ?? new Prisma.Decimal(0));
            const bucket = byDate.get(dateKey) ?? { in: new Prisma.Decimal(0), out: new Prisma.Decimal(0) };
            if (row.direction === "IN") bucket.in = bucket.in.plus(value);
            else bucket.out = bucket.out.plus(value);
            byDate.set(dateKey, bucket);
        }

        return Array.from(byDate.entries())
            .map(([date, v]) => ({ date, in: v.in.toString(), out: v.out.toString() }))
            .sort((a, b) => a.date.localeCompare(b.date));
    },

    /** Consumption valued at avg purchase cost, grouped by item category
     * over `days` days -- mirrors purchasesByCategory's shape. */
    async consumptionByCategory(days: number) {
        const since = new Date(Date.now() - days * 86_400_000);
        since.setUTCHours(0, 0, 0, 0);
        const rows = await prisma.consumption.findMany({
            where: { date: { gte: since, lte: new Date() } },
            select: { item_id: true, quantity: true, item: { select: { category: true } } },
        });
        const avgCosts = await getItemAvgCosts(Array.from(new Set(rows.map((r) => r.item_id))));

        const byCategory = new Map<string, Prisma.Decimal>();
        for (const row of rows) {
            const value = row.quantity.times(avgCosts.get(row.item_id) ?? new Prisma.Decimal(0));
            byCategory.set(row.item.category, (byCategory.get(row.item.category) ?? new Prisma.Decimal(0)).plus(value));
        }

        return Array.from(byCategory.entries())
            .map(([category, total]) => ({ category, total: total.toString() }))
            .sort((a, b) => parseFloat(b.total) - parseFloat(a.total));
    },

    /** Daily total consumption value over `days` days -- mirrors purchasesTrend's shape. */
    async consumptionTrend(days: number) {
        const since = new Date(Date.now() - days * 86_400_000);
        since.setUTCHours(0, 0, 0, 0);
        const rows = await prisma.consumption.findMany({
            where: { date: { gte: since, lte: new Date() } },
            select: { item_id: true, quantity: true, date: true },
        });
        const avgCosts = await getItemAvgCosts(Array.from(new Set(rows.map((r) => r.item_id))));

        const byDate = new Map<string, Prisma.Decimal>();
        for (const row of rows) {
            const dateKey = row.date.toISOString().slice(0, 10);
            const value = row.quantity.times(avgCosts.get(row.item_id) ?? new Prisma.Decimal(0));
            byDate.set(dateKey, (byDate.get(dateKey) ?? new Prisma.Decimal(0)).plus(value));
        }

        return Array.from(byDate.entries())
            .map(([date, total]) => ({ date, total: total.toString() }))
            .sort((a, b) => a.date.localeCompare(b.date));
    },

    /** Value lost to WASTAGE/EXPIRED stock-ledger entries, by category, over
     * `days` days. No current write path posts those reasons (adjustments
     * always log as ADJUSTMENT) -- this is forward-compatible and will read
     * empty until one does, not a bug. */
    async wastageByCategory(days: number) {
        const since = new Date(Date.now() - days * 86_400_000);
        since.setUTCHours(0, 0, 0, 0);
        const rows = await prisma.stockLedger.findMany({
            where: { occurred_at: { gte: since, lte: new Date() }, reason: { in: ["WASTAGE", "EXPIRED"] } },
            select: { item_id: true, quantity: true, item: { select: { category: true } } },
        });
        const avgCosts = await getItemAvgCosts(Array.from(new Set(rows.map((r) => r.item_id))));

        const byCategory = new Map<string, Prisma.Decimal>();
        for (const row of rows) {
            const value = row.quantity.times(avgCosts.get(row.item_id) ?? new Prisma.Decimal(0));
            byCategory.set(row.item.category, (byCategory.get(row.item.category) ?? new Prisma.Decimal(0)).plus(value));
        }

        return Array.from(byCategory.entries())
            .map(([category, total]) => ({ category, total: total.toString() }))
            .sort((a, b) => parseFloat(b.total) - parseFloat(a.total));
    },
};
