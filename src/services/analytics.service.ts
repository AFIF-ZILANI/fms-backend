import prisma from "@lib/db";
import { Prisma } from "../../prisma/generated/prisma/client";
import { AppError } from "@lib/app-error";
import { PaymentInstrumentService } from "@services/payment-instrument.service";
import type { FinancialDashboardQuery } from "@validators/analytics.validator";

// Reporting is deliberately read-only against every other module's tables
// (system-design-arc.md §3) -- no state of its own, only queries. Scoped to
// the aggregates that genuinely need cross-table computation; anything
// that's just a filtered list (mortality trend, feed consumption trend,
// growth curve) is already available from the module that owns it --
// GET /api/mortality-logs, /api/consumptions, /api/weight-records all
// support date-range filters already, so a redundant "trend" endpoint here
// would just reshape data the frontend can already chart directly.
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
    async batchesPerformance(status: "RUNNING" | "CLOSED" | "SOLD") {
        const batches = await prisma.batches.findMany({
            where: { status },
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

        const [saleRevenue, birdSaleRevenue, expenses, purchasesDue, instruments] =
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
                prisma.paymentInstrument.findMany({ where: { is_active: true } }),
            ]);

        const revenue = (saleRevenue._sum.total ?? new Prisma.Decimal(0)).plus(
            birdSaleRevenue._sum.total_amount ?? new Prisma.Decimal(0),
        );
        const expenseTotal = expenses._sum.amount ?? new Prisma.Decimal(0);

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
        const rows = await prisma.mortalityLog.findMany({
            where: { date: { gte: since } },
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
        const rows = await prisma.consumption.findMany({
            where: { date: { gte: since }, item: { category: "FEED" } },
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
        const rows = await prisma.birdSale.findMany({
            where: { sale_date: { gte: since } },
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
};
