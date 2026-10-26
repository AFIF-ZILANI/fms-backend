import prisma from "@lib/db";
import { trendWindow } from "@lib/trend-window";
import { Prisma } from "../../prisma/generated/prisma/client";
import { AppError } from "@lib/app-error";
import { getItemBalances } from "@lib/stock-balance";
import { getItemAvgCosts } from "@lib/stock-value";
import { chargeRatios, landedTotal } from "@lib/purchase-charges";
import { BatchPnlService } from "@services/batch-pnl.service";
import { isNonDepleting } from "@lib/coded-stock";
import { PAYROLL_EXPENSE_CATEGORIES } from "@lib/paid-at-create";
import type { FinancialDashboardQuery } from "@validators/analytics.validator";

// kgPerBaseUnit lives with the other unit maths; re-exported for existing callers.
export { kgPerBaseUnit } from "@lib/unit-conversion";
import { kgPerBaseUnit } from "@lib/unit-conversion";

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
                // Only the count of occupied balances per house, not every balance row.
                prisma.houses.findMany({
                    where: { is_active: true },
                    select: {
                        _count: {
                            select: { batchHouseBalances: { where: { quantity: { gt: 0 } } } },
                        },
                    },
                }),
                prisma.employees.count({ where: { profile: { is_active: true } } }),
                prisma.alerts.groupBy({
                    by: ["level"],
                    where: { status: "ACTIVE" },
                    _count: { _all: true },
                }),
            ]);

        const housesOccupied = houses.filter((h) => h._count.batchHouseBalances > 0).length;

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

    /** FCR and cost live on batchesPerformance only (the Analytics page's source); this
     * single-batch version keeps its original shape for the batch detail page. */
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
            orderBy: [{ date: "desc" }, { created_at: "desc" }],
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

        const [
            mortalityByBatch,
            weightRecords,
            consumptions,
            soldByBatch,
            batchPurchases,
            directExpenses,
            depreciation,
        ] = await Promise.all([
            prisma.mortalityLog.groupBy({
                by: ["batch_id"],
                where: { batch_id: { in: batchIds } },
                _sum: { count_died: true },
            }),
            prisma.weightRecords.findMany({
                where: { batch_id: { in: batchIds } },
                // Several houses can be weighed on one day now that date is a day, not a timestamp;
                // the most recently entered sample wins the tie.
                orderBy: [{ date: "desc" }, { created_at: "desc" }],
                select: { batch_id: true, average_wt_grams: true, date: true },
            }),
            prisma.consumption.findMany({
                where: { batch_id: { in: batchIds } },
                select: {
                    batch_id: true,
                    item_id: true,
                    base_quantity: true,
                    item: {
                        select: {
                            category: true,
                            unit: true,
                            itemUnits: { select: { unit: true, factor_to_base: true } },
                        },
                    },
                },
            }),
            prisma.birdSale.groupBy({
                by: ["batch_id"],
                where: { batch_id: { in: batchIds } },
                _sum: { net_weight: true },
            }),
            prisma.purchaseItem.groupBy({
                by: ["batch_id", "item_id", "purchase_id"],
                where: { batch_id: { in: batchIds } },
                _sum: { total_price: true },
            }),
            prisma.expense.groupBy({
                by: ["batch_id"],
                where: { batch_id: { in: batchIds }, cost_type: "DIRECT" },
                _sum: { amount: true },
            }),
            prisma.assetDepreciation.groupBy({
                by: ["batch_id"],
                where: { batch_id: { in: batchIds } },
                _sum: { amount: true },
            }),
        ]);
        const avgCosts = await getItemAvgCosts([...new Set(consumptions.map((c) => c.item_id))]);

        // Cost to date = what batchPnl counts (batch-linked purchases, direct expenses, depreciation)
        // plus consumed stock valued at avg purchase cost -- batchPnl leaves feed/medicine out.
        // An item bought straight onto this batch is already in its purchase cost, so its
        // consumption isn't counted again.
        const zero = new Prisma.Decimal(0);
        const costByBatch = new Map<string, Prisma.Decimal>();
        const addCost = (batchId: string | null, amount: Prisma.Decimal | null) => {
            if (batchId && amount)
                costByBatch.set(batchId, (costByBatch.get(batchId) ?? zero).plus(amount));
        };
        const purchasedOnBatch = new Set<string>();
        const ratios = await chargeRatios(batchPurchases.map((p) => p.purchase_id));
        for (const p of batchPurchases) {
            addCost(
                p.batch_id,
                landedTotal({ purchase_id: p.purchase_id, total_price: p._sum.total_price ?? zero }, ratios),
            );
            purchasedOnBatch.add(`${p.batch_id}|${p.item_id}`);
        }
        for (const e of directExpenses) addCost(e.batch_id, e._sum.amount);
        for (const d of depreciation) addCost(d.batch_id, d._sum.amount);

        // FCR is null for a batch when any of its feed can't be expressed in kg -- a partial
        // feed total would print a flattering ratio, which is worse than none.
        const feedKgByBatch = new Map<string, number | null>();
        for (const c of consumptions) {
            if (!c.batch_id) continue;
            // ponytail: unpurchased item = unknown cost, skipped (same rule as getItemAvgCosts' callers).
            const avgCost = avgCosts.get(c.item_id);
            // Equipment reaches a batch through depreciation, not through its draws.
            if (
                avgCost &&
                !purchasedOnBatch.has(`${c.batch_id}|${c.item_id}`) &&
                !isNonDepleting(c.item.category)
            ) {
                addCost(c.batch_id, c.base_quantity.times(avgCost));
            }
            if (c.item.category !== "FEED") continue;
            const kgPerUnit = kgPerBaseUnit(c.item.unit, c.item.itemUnits);
            const soFar = feedKgByBatch.has(c.batch_id) ? feedKgByBatch.get(c.batch_id)! : 0;
            feedKgByBatch.set(
                c.batch_id,
                kgPerUnit === null || soFar === null
                    ? null
                    : soFar + c.base_quantity.toNumber() * kgPerUnit,
            );
        }

        const soldKgByBatch = new Map(
            soldByBatch.map((s) => [s.batch_id, s._sum.net_weight?.toNumber() ?? 0]),
        );
        const diedByBatch = new Map(
            mortalityByBatch.map((m) => [m.batch_id, m._sum.count_died ?? 0]),
        );
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
            // Live weight now (latest sample x birds on hand) + weight already sold. Without a weighing
            // there's no honest figure, so everything weight-based stays null.
            // ponytail: one house's latest sample stands in for the whole batch; weight by house balance if houses diverge.
            const producedKg = latestWeight
                ? (latestWeight.average_wt_grams.toNumber() * liveCount) / 1000 +
                  (soldKgByBatch.get(batch.id) ?? 0)
                : null;
            const gainKg =
                producedKg === null
                    ? null
                    : producedKg - (batch.initial_chick_count * batch.init_chicks_avg_wt) / 1000;
            const feedKg = feedKgByBatch.has(batch.id) ? feedKgByBatch.get(batch.id)! : 0;
            const cost = costByBatch.get(batch.id) ?? zero;
            return {
                batch_id: batch.id,
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
                feed_kg: feedKg,
                weight_gain_kg: gainKg,
                fcr: feedKg && gainKg && gainKg > 0 ? feedKg / gainKg : null,
                cost_to_date: cost.toString(),
                cost_per_kg:
                    producedKg && producedKg > 0 && !cost.isZero()
                        ? cost.div(producedKg).toString()
                        : null,
            };
        });
    },

    /** revenue - purchase cost (chicks, batch-linked) - direct expenses -
     * depreciation share. Shared-period costs stay unallocated -- the
     * bird-days formula that would distribute them is explicitly v2
     * (system-design-arc.md §7), not guessed at here. */
    async batchPnl(batchId: string) {
        // The statement is the source of truth; the flat fields are kept for existing callers
        // (batch detail page, simulations). `profit` is the contribution, before farm-wide costs.
        const st = await BatchPnlService.statement(batchId);
        const sum = (sections: string[]) =>
            st.cost_lines.filter((l) => sections.includes(l.section)).reduce((a, l) => a + l.amount, 0);
        const unallocated = await prisma.expense.aggregate({
            where: { batch_id: batchId, cost_type: "SHARED_PERIOD" },
            _sum: { amount: true },
        });
        return {
            batch_id: batchId,
            revenue: new Prisma.Decimal(st.revenue.net),
            purchase_cost: new Prisma.Decimal(sum(["CHICKS"])),
            consumption_cost: new Prisma.Decimal(sum(["FEED", "HEALTH", "SUPPLIES"]).toFixed(2)),
            direct_expenses: new Prisma.Decimal(sum(["DIRECT"])),
            depreciation_share: new Prisma.Decimal(sum(["DEPRECIATION"])),
            shared_period_expenses_unallocated: unallocated._sum.amount ?? new Prisma.Decimal(0),
            profit: new Prisma.Decimal(st.contribution),
            statement: st,
        };
    },

    async financialDashboard(query: FinancialDashboardQuery) {
        const month = query.month ?? new Date();
        const monthStart = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
        const monthEnd = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));

        const [
            saleRevenue,
            birdSaleRevenue,
            expenses,
            purchasesDue,
            expensesOwed,
            salesDue,
            birdSalesDue,
            paidByType,
            instruments,
        ] = await Promise.all([
            prisma.sale.aggregate({
                where: { sale_date: { gte: monthStart, lt: monthEnd } },
                _sum: { total: true },
            }),
            prisma.birdSale.aggregate({
                where: { sale_date: { gte: monthStart, lt: monthEnd } },
                _sum: { total_amount: true, discount_amount: true },
            }),
            prisma.expense.aggregate({
                // A purchase charge (STOCK) is already inside stock cost via the landed average -- not again here.
                where: { date: { gte: monthStart, lt: monthEnd }, cost_type: { not: "STOCK" } },
                _sum: { amount: true },
            }),
            prisma.purchase.aggregate({ _sum: { due_amount: true } }),
            // Payroll's own expenses are settled by their payout, never owed as an expense.
            prisma.expense.aggregate({
                where: { category: { notIn: PAYROLL_EXPENSE_CATEGORIES } },
                _sum: { amount: true },
            }),
            prisma.sale.aggregate({ _sum: { due_amount: true } }),
            prisma.birdSale.aggregate({ _sum: { due_amount: true } }),
            // due_amount is the create-time snapshot; what has been paid since lives in Payment.
            prisma.payment.groupBy({
                by: ["ref_type"],
                where: { ref_type: { in: ["PURCHASE", "SALE", "BIRD_SALE", "EXPENSE"] } },
                _sum: { amount: true },
            }),
            prisma.paymentInstrument.findMany({ where: { is_active: true } }),
        ]);
        const zeroDec = new Prisma.Decimal(0);
        const paid = (t: string) =>
            paidByType.find((r) => r.ref_type === t)?._sum.amount ?? zeroDec;

        const revenue = (saleRevenue._sum.total ?? new Prisma.Decimal(0)).plus(
            (birdSaleRevenue._sum.total_amount ?? new Prisma.Decimal(0)).minus(
                birdSaleRevenue._sum.discount_amount ?? new Prisma.Decimal(0),
            ),
        );
        const expenseTotal = expenses._sum.amount ?? new Prisma.Decimal(0);
        // Net of payments, the same identity SaleService.summary uses -- exact, because a payment
        // that would overpay a record is refused.
        const outstandingReceivables = (salesDue._sum.due_amount ?? zeroDec)
            .minus(paid("SALE"))
            .plus((birdSalesDue._sum.due_amount ?? zeroDec).minus(paid("BIRD_SALE"))); // raw Prisma.Decimal, not .toString()'d -- matches every sibling

        // Two grouped queries for every instrument at once, not three queries per instrument.
        const ids = instruments.map((i) => i.id);
        const [inRows, outRows] = await Promise.all([
            prisma.payment.groupBy({
                by: ["to_instrument_id"],
                where: { to_instrument_id: { in: ids } },
                _sum: { amount: true },
            }),
            prisma.payment.groupBy({
                by: ["from_instrument_id"],
                where: { from_instrument_id: { in: ids } },
                _sum: { amount: true },
            }),
        ]);
        const zero = new Prisma.Decimal(0);
        const inBy = new Map(inRows.map((r) => [r.to_instrument_id, r._sum.amount ?? zero]));
        const outBy = new Map(outRows.map((r) => [r.from_instrument_id, r._sum.amount ?? zero]));
        const balances = ids.map((id) => ({
            balance: (inBy.get(id) ?? zero).minus(outBy.get(id) ?? zero),
        }));
        const cashPosition = balances.reduce(
            (sum, b) => sum.plus(b.balance),
            new Prisma.Decimal(0),
        );

        return {
            month: monthStart.toISOString().slice(0, 7),
            revenue,
            expenses: expenseTotal,
            gross_profit: revenue.minus(expenseTotal),
            // Unpaid purchases and unpaid expenses: both are money the farm still has to pay out.
            outstanding_payables: (purchasesDue._sum.due_amount ?? zeroDec)
                .minus(paid("PURCHASE"))
                .plus((expensesOwed._sum.amount ?? zeroDec).minus(paid("EXPENSE"))),
            outstanding_receivables: outstandingReceivables,
            cash_position: cashPosition,
            cash_by_instrument: instruments.map((inst, i) => ({
                instrument_id: inst.id,
                label: inst.label,
                balance: balances[i]!.balance,
            })),
        };
    },

    /** Daily deaths and daily mortality rate across every batch, last `days` days, one row per
     * day (zero-filled -- a rate line with gaps would draw straight through quiet days). The rate
     * is deaths / birds alive at the start of that day, so a 7,500-bird batch and a 200-bird
     * batch losing the same count no longer look alike. Birds alive is rebuilt from placements
     * minus earlier deaths and sales; days bucket by calendar day (YYYY-MM-DD). */
    async mortalityTrend(days: number) {
        const window = trendWindow(days);
        const batches = await prisma.batches.findMany({
            where: {
                starting_date: { lte: window.lte },
                OR: [{ actual_end_date: null }, { actual_end_date: { gte: window.gte } }],
            },
            select: {
                id: true,
                initial_chick_count: true,
                starting_date: true,
                actual_end_date: true,
            },
        });
        const ids = batches.map((b) => b.id);
        const [logs, sales] = await Promise.all([
            prisma.mortalityLog.findMany({
                where: { batch_id: { in: ids }, date: { lte: window.lte } },
                select: { batch_id: true, date: true, count_died: true },
            }),
            prisma.birdSale.findMany({
                where: { batch_id: { in: ids }, sale_date: { lte: window.lte } },
                select: { batch_id: true, sale_date: true, birds_count: true },
            }),
        ]);
        const removals = [
            ...logs.map((l) => ({ batch_id: l.batch_id, at: l.date.getTime(), n: l.count_died })),
            ...sales.map((s) => ({
                batch_id: s.batch_id,
                at: s.sale_date.getTime(),
                n: s.birds_count,
            })),
        ];

        // ponytail: O(days x events) rescan, fine at farm volumes; prefix-sum per batch if it gets slow.
        const rows = [];
        for (let t = window.gte.getTime(); t <= window.lte.getTime(); t += 86_400_000) {
            const dayEnd = t + 86_400_000;
            const active = new Set(
                batches
                    .filter(
                        (b) =>
                            b.starting_date.getTime() < dayEnd &&
                            (!b.actual_end_date || b.actual_end_date.getTime() >= t),
                    )
                    .map((b) => b.id),
            );
            let alive = batches.reduce(
                (sum, b) => (active.has(b.id) ? sum + b.initial_chick_count : sum),
                0,
            );
            for (const r of removals) if (active.has(r.batch_id) && r.at < t) alive -= r.n;
            const died = logs.reduce((sum, l) => {
                const at = l.date.getTime();
                return at >= t && at < dayEnd ? sum + l.count_died : sum;
            }, 0);
            rows.push({
                date: new Date(t).toISOString().slice(0, 10),
                died,
                birds_alive: Math.max(alive, 0),
                rate: alive > 0 ? died / alive : 0,
            });
        }
        return rows;
    },

    /** Daily FEED-category consumption in kg. Items with a weight conversion (base unit KG/G/...,
     * or an ItemUnit to one) are summed together as KG; an item with no conversion keeps its own
     * unit row -- quantities in unknown-weight units (a BAG of unstated size) are never summed into
     * kg. A raw groupBy can't reach through the item relation for unit, so this groups in memory. */
    async feedTrend(days: number) {
        const window = trendWindow(days);
        // ponytail: this string is a live FK code (ItemCategory.code) a user can rename via Settings,
        // which silently breaks this comparison with no error -- needs a stable-key mechanism if this keeps mattering.
        const rows = await prisma.consumption.findMany({
            where: { date: window, item: { category: "FEED" } },
            select: {
                date: true,
                base_quantity: true,
                item: {
                    select: {
                        unit: true,
                        itemUnits: { select: { unit: true, factor_to_base: true } },
                    },
                },
            },
        });

        const byKey = new Map<string, Prisma.Decimal>();
        for (const row of rows) {
            const dateKey = row.date.toISOString().slice(0, 10);
            const kgPerUnit = kgPerBaseUnit(row.item.unit, row.item.itemUnits);
            const key = `${dateKey}|${kgPerUnit === null ? row.item.unit : "KG"}`;
            const amount =
                kgPerUnit === null ? row.base_quantity : row.base_quantity.times(kgPerUnit);
            byKey.set(key, (byKey.get(key) ?? new Prisma.Decimal(0)).plus(amount));
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
        const window = trendWindow(days);
        const rows = await prisma.birdSale.findMany({
            where: { sale_date: window },
            select: {
                sale_date: true,
                total_amount: true,
                discount_amount: true,
                net_weight: true,
            },
        });

        const byDate = new Map<string, { revenue: Prisma.Decimal; weight: Prisma.Decimal }>();
        for (const row of rows) {
            const dateKey = row.sale_date.toISOString().slice(0, 10);
            const existing = byDate.get(dateKey) ?? {
                revenue: new Prisma.Decimal(0),
                weight: new Prisma.Decimal(0),
            };
            byDate.set(dateKey, {
                revenue: existing.revenue.plus(row.total_amount).minus(row.discount_amount),
                weight: existing.weight.plus(row.net_weight),
            });
        }

        return Array.from(byDate.entries())
            .map(([date, { revenue, weight }]) => ({
                date,
                revenue: revenue.toString(),
                avg_price_per_kg: (weight.isZero()
                    ? new Prisma.Decimal(0)
                    : revenue.div(weight)
                ).toString(),
            }))
            .sort((a, b) => a.date.localeCompare(b.date));
    },

    /** Revenue per product line over `days` days -- Regular Sale line-item
     * revenue grouped by Item.category, plus total BirdSale revenue folded
     * in as its own "BIRD" entry (BirdSale has no Item/category of its own). */
    async salesByProductLine(days: number) {
        const window = trendWindow(days);

        const [saleItems, birdSaleRevenue] = await Promise.all([
            prisma.saleItem.findMany({
                where: { sale: { sale_date: window } },
                select: { total_price: true, item: { select: { category: true } } },
            }),
            prisma.birdSale.aggregate({
                where: { sale_date: window },
                _sum: { total_amount: true, discount_amount: true },
            }),
        ]);

        const byCategory = new Map<string, Prisma.Decimal>();
        for (const row of saleItems) {
            const category = row.item.category;
            byCategory.set(
                category,
                (byCategory.get(category) ?? new Prisma.Decimal(0)).plus(row.total_price),
            );
        }
        const birdRevenue = (birdSaleRevenue._sum.total_amount ?? new Prisma.Decimal(0)).minus(
            birdSaleRevenue._sum.discount_amount ?? new Prisma.Decimal(0),
        );
        if (!birdRevenue.isZero()) {
            byCategory.set(
                "BIRD",
                (byCategory.get("BIRD") ?? new Prisma.Decimal(0)).plus(birdRevenue),
            );
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
        const window = trendWindow(days);

        const grouped = await prisma.birdSale.groupBy({
            by: ["grade"],
            where: { sale_date: window },
            _sum: {
                birds_count: true,
                total_amount: true,
                discount_amount: true,
                net_weight: true,
            },
        });

        // net_weight rides along so avg price/kg is revenue/weight over this
        // exact window -- computing it client-side used a different window
        // boundary and only the latest page of bird sales.
        return grouped
            .map((row) => ({
                grade: row.grade,
                birds_count: row._sum.birds_count ?? 0,
                revenue: (row._sum.total_amount ?? new Prisma.Decimal(0))
                    .minus(row._sum.discount_amount ?? new Prisma.Decimal(0))
                    .toString(),
                net_weight: (row._sum.net_weight ?? new Prisma.Decimal(0)).toString(),
            }))
            .sort((a, b) => b.birds_count - a.birds_count);
    },

    /** Customers ranked by total outstanding receivable across Sale and
     * BirdSale. Payments carry no customer_id, so the ref_id -> customer
     * mapping is joined in memory here (same shape as salesByProductLine).
     * Rows with no customer are excluded -- an unattributed due can't be
     * chased. All-time, not period-scoped: receivables don't reset with a
     * date range. */
    async topOutstandingCustomers(limit: number) {
        const [sales, birdSales, salePayments, birdSalePayments] = await Promise.all([
            prisma.sale.findMany({
                where: { customer_id: { not: null }, due_amount: { gt: 0 } },
                select: { id: true, customer_id: true, due_amount: true },
            }),
            prisma.birdSale.findMany({
                where: { customer_id: { not: null }, due_amount: { gt: 0 } },
                select: { id: true, customer_id: true, due_amount: true },
            }),
            prisma.payment.groupBy({
                by: ["ref_id"],
                where: { ref_type: "SALE" },
                _sum: { amount: true },
            }),
            prisma.payment.groupBy({
                by: ["ref_id"],
                where: { ref_type: "BIRD_SALE" },
                _sum: { amount: true },
            }),
        ]);

        const paid = new Map<string, Prisma.Decimal>();
        for (const row of [...salePayments, ...birdSalePayments]) {
            paid.set(row.ref_id, row._sum.amount ?? new Prisma.Decimal(0));
        }

        const dueByCustomer = new Map<string, Prisma.Decimal>();
        for (const row of [...sales, ...birdSales]) {
            const outstanding = row.due_amount.minus(paid.get(row.id) ?? new Prisma.Decimal(0));
            if (outstanding.lessThanOrEqualTo(0)) continue;
            const key = row.customer_id!;
            dueByCustomer.set(
                key,
                (dueByCustomer.get(key) ?? new Prisma.Decimal(0)).plus(outstanding),
            );
        }

        const ranked = Array.from(dueByCustomer.entries())
            .sort((a, b) => b[1].comparedTo(a[1]))
            .slice(0, limit);

        const customers = await prisma.customers.findMany({
            where: { id: { in: ranked.map(([id]) => id) } },
            select: { id: true, profile: { select: { name: true } } },
        });

        return ranked.map(([customer_id, due]) => ({
            customer_id,
            customer_name:
                customers.find((c) => c.id === customer_id)?.profile.name ?? "Unknown customer",
            due: due.toString(),
        }));
    },

    /** Spend per category over `days` days -- PurchaseItem cost grouped by
     * Item.category. Unlike salesByProductLine, no synthetic category is
     * needed here: every PurchaseItem always has a real Item/category. */
    async purchasesByCategory(days: number) {
        const window = trendWindow(days);

        const purchaseItems = await prisma.purchaseItem.findMany({
            where: { purchase: { purchase_date: window, is_opening: false } },
            select: { total_price: true, item: { select: { category: true } } },
        });

        const byCategory = new Map<string, Prisma.Decimal>();
        for (const row of purchaseItems) {
            const category = row.item.category;
            byCategory.set(
                category,
                (byCategory.get(category) ?? new Prisma.Decimal(0)).plus(row.total_price),
            );
        }

        return Array.from(byCategory.entries())
            .map(([category, total]) => ({ category, total: total.toString() }))
            .sort((a, b) => parseFloat(b.total) - parseFloat(a.total));
    },

    /** Daily total purchase spend over `days` days -- buckets in memory by
     * calendar day rather than a raw groupBy: `purchase_date` is a
     * full-precision DateTime, so a Prisma groupBy on it would treat two
     * purchases on the same day at different times as separate groups --
     * same trap salesTrend/mortalityTrend work around the same way. */
    async purchasesTrend(days: number) {
        const window = trendWindow(days);
        const rows = await prisma.purchase.findMany({
            where: { purchase_date: window, is_opening: false },
            select: { purchase_date: true, total_amount: true },
        });

        const byDate = new Map<string, Prisma.Decimal>();
        for (const row of rows) {
            const dateKey = row.purchase_date.toISOString().slice(0, 10);
            byDate.set(
                dateKey,
                (byDate.get(dateKey) ?? new Prisma.Decimal(0)).plus(row.total_amount),
            );
        }

        return Array.from(byDate.entries())
            .map(([date, total]) => ({ date, total: total.toString() }))
            .sort((a, b) => a.date.localeCompare(b.date));
    },

    async expenseBreakdown(month?: Date) {
        const resolvedMonth = month ?? new Date();
        const monthStart = new Date(
            Date.UTC(resolvedMonth.getUTCFullYear(), resolvedMonth.getUTCMonth(), 1),
        );
        const monthEnd = new Date(
            Date.UTC(resolvedMonth.getUTCFullYear(), resolvedMonth.getUTCMonth() + 1, 1),
        );

        const grouped = await prisma.expense.groupBy({
            by: ["category"],
            // A purchase charge (STOCK) is already inside stock cost via the landed average -- not again here.
            where: { date: { gte: monthStart, lt: monthEnd }, cost_type: { not: "STOCK" } },
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
            const monthEnd = new Date(
                Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 1),
            );
            return { label: monthStart.toISOString().slice(0, 7), monthStart, monthEnd };
        });

        // Three range reads over the whole window, bucketed by month here (the pattern every
        // trend in this file uses), instead of three aggregates per month.
        const from = windows[windows.length - 1]!.monthStart;
        const to = windows[0]!.monthEnd;
        const [sales, birdSales, expenses] = await Promise.all([
            prisma.sale.findMany({
                where: { sale_date: { gte: from, lt: to } },
                select: { sale_date: true, total: true },
            }),
            prisma.birdSale.findMany({
                where: { sale_date: { gte: from, lt: to } },
                select: { sale_date: true, total_amount: true, discount_amount: true },
            }),
            prisma.expense.findMany({
                // A purchase charge (STOCK) is already inside stock cost via the landed average -- not again here.
                where: { date: { gte: from, lt: to }, cost_type: { not: "STOCK" } },
                select: { date: true, amount: true },
            }),
        ]);
        const zero = new Prisma.Decimal(0);
        const byMonth = new Map(windows.map((w) => [w.label, { revenue: zero, expenses: zero }]));
        const bucket = (d: Date) => byMonth.get(d.toISOString().slice(0, 7));
        for (const s of sales) {
            const m = bucket(s.sale_date);
            if (m) m.revenue = m.revenue.plus(s.total);
        }
        for (const s of birdSales) {
            const m = bucket(s.sale_date);
            if (m) m.revenue = m.revenue.plus(s.total_amount).minus(s.discount_amount);
        }
        for (const e of expenses) {
            const m = bucket(e.date);
            if (m) m.expenses = m.expenses.plus(e.amount);
        }
        const rows = windows.map((w) => ({
            month: w.label,
            revenue: byMonth.get(w.label)!.revenue.toString(),
            expenses: byMonth.get(w.label)!.expenses.toString(),
        }));

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
        const [balances, avgCosts] = await Promise.all([
            getItemBalances(itemIds),
            getItemAvgCosts(itemIds),
        ]);

        const byCategory = new Map<string, Prisma.Decimal>();
        for (const item of items) {
            const balance = balances.get(item.id) ?? new Prisma.Decimal(0);
            const avgCost = avgCosts.get(item.id);
            if (!avgCost || balance.lessThanOrEqualTo(0)) continue;
            const value = balance.times(avgCost);
            byCategory.set(
                item.category,
                (byCategory.get(item.category) ?? new Prisma.Decimal(0)).plus(value),
            );
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
        const window = trendWindow(days);
        const rows = await prisma.stockLedger.findMany({
            where: { occurred_at: window },
            select: { item_id: true, quantity: true, direction: true, occurred_at: true },
        });
        const avgCosts = await getItemAvgCosts(Array.from(new Set(rows.map((r) => r.item_id))));

        const byDate = new Map<string, { in: Prisma.Decimal; out: Prisma.Decimal }>();
        for (const row of rows) {
            const dateKey = row.occurred_at.toISOString().slice(0, 10);
            const value = row.quantity.times(avgCosts.get(row.item_id) ?? new Prisma.Decimal(0));
            const bucket = byDate.get(dateKey) ?? {
                in: new Prisma.Decimal(0),
                out: new Prisma.Decimal(0),
            };
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
        const window = trendWindow(days);
        const rows = await prisma.consumption.findMany({
            where: { date: window },
            select: { item_id: true, base_quantity: true, item: { select: { category: true } } },
        });
        const avgCosts = await getItemAvgCosts(Array.from(new Set(rows.map((r) => r.item_id))));

        const byCategory = new Map<string, Prisma.Decimal>();
        for (const row of rows) {
            const value = row.base_quantity.times(
                avgCosts.get(row.item_id) ?? new Prisma.Decimal(0),
            );
            byCategory.set(
                row.item.category,
                (byCategory.get(row.item.category) ?? new Prisma.Decimal(0)).plus(value),
            );
        }

        return Array.from(byCategory.entries())
            .map(([category, total]) => ({ category, total: total.toString() }))
            .sort((a, b) => parseFloat(b.total) - parseFloat(a.total));
    },

    /** Daily total consumption value over `days` days -- mirrors purchasesTrend's shape. */
    async consumptionTrend(days: number) {
        const window = trendWindow(days);
        const rows = await prisma.consumption.findMany({
            where: { date: window },
            select: { item_id: true, base_quantity: true, date: true },
        });
        const avgCosts = await getItemAvgCosts(Array.from(new Set(rows.map((r) => r.item_id))));

        const byDate = new Map<string, Prisma.Decimal>();
        for (const row of rows) {
            const dateKey = row.date.toISOString().slice(0, 10);
            const value = row.base_quantity.times(
                avgCosts.get(row.item_id) ?? new Prisma.Decimal(0),
            );
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
        const window = trendWindow(days);
        const rows = await prisma.stockLedger.findMany({
            where: { occurred_at: window, reason: { in: ["WASTAGE", "EXPIRED"] } },
            select: { item_id: true, quantity: true, item: { select: { category: true } } },
        });
        const avgCosts = await getItemAvgCosts(Array.from(new Set(rows.map((r) => r.item_id))));

        const byCategory = new Map<string, Prisma.Decimal>();
        for (const row of rows) {
            const value = row.quantity.times(avgCosts.get(row.item_id) ?? new Prisma.Decimal(0));
            byCategory.set(
                row.item.category,
                (byCategory.get(row.item.category) ?? new Prisma.Decimal(0)).plus(value),
            );
        }

        return Array.from(byCategory.entries())
            .map(([category, total]) => ({ category, total: total.toString() }))
            .sort((a, b) => parseFloat(b.total) - parseFloat(a.total));
    },
};
