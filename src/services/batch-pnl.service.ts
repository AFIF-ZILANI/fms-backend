import prisma from "@lib/db";
import { Prisma } from "../../prisma/generated/prisma/client";
import { AppError } from "@lib/app-error";
import { getItemAvgCosts } from "@lib/stock-value";
import { isNonDepleting } from "@lib/coded-stock";
import { kgPerBaseUnit } from "@lib/unit-conversion";
import { SharedCostService, type SharedMonth } from "@services/shared-cost.service";

/**
 * A batch's profit and loss, as a statement that adds up line by line:
 *
 *   revenue (bird sales, net of discount)
 *   − chicks − feed − medicine & vaccines − bedding & supplements − direct expenses − depreciation
 *   = contribution          (what the batch earned before farm-wide costs; the old `profit` field)
 *   − share of farm-wide costs (bird-days, see SharedCostService)
 *   = net profit
 *
 * Stock is costed when used, at its average purchase price; equipment reaches a batch only through
 * depreciation. A running batch shows its figures so far.
 */
export type StatementLine = { section: Section; label: string; amount: number };
export type Section = "CHICKS" | "FEED" | "HEALTH" | "SUPPLIES" | "DIRECT" | "DEPRECIATION";
export const SECTION_LABELS: Record<Section, string> = {
    CHICKS: "Chicks",
    FEED: "Feed",
    HEALTH: "Medicine & vaccines",
    SUPPLIES: "Bedding & supplements",
    DIRECT: "Direct expenses",
    DEPRECIATION: "Equipment depreciation",
};
const HEALTH = new Set(["MEDICINE", "VACCINE"]);

const D = (v: Prisma.Decimal | number | string | null | undefined) => new Prisma.Decimal(v ?? 0);
const n = (d: Prisma.Decimal | number) => Number(D(d).toFixed(2));

async function statementFor(batchId: string, shared: SharedMonth[]) {
    const batch = await prisma.batches.findUnique({
        where: { id: batchId },
        include: { houseBalances: true },
    });
    if (!batch) throw AppError.notFound("Batch");

    const [
        sales,
        died,
        chicks,
        consumed,
        direct,
        depreciation,
        latestWeight,
        categories,
        expenseLabels,
    ] = await Promise.all([
        prisma.birdSale.findMany({
            where: { batch_id: batchId },
            select: {
                id: true,
                total_amount: true,
                discount_amount: true,
                due_amount: true,
                net_weight: true,
                birds_count: true,
            },
        }),
        prisma.mortalityLog.aggregate({ where: { batch_id: batchId }, _sum: { count_died: true } }),
        prisma.purchaseItem.findMany({
            where: { batch_id: batchId },
            select: { item_id: true, total_price: true, quantity: true },
        }),
        prisma.consumption.findMany({
            where: { batch_id: batchId },
            select: {
                item_id: true,
                base_quantity: true,
                item: {
                    select: {
                        name: true,
                        category: true,
                        unit: true,
                        itemUnits: { select: { unit: true, factor_to_base: true } },
                    },
                },
            },
        }),
        prisma.expense.groupBy({
            by: ["category"],
            where: { batch_id: batchId, cost_type: "DIRECT" },
            _sum: { amount: true },
        }),
        prisma.assetDepreciation.aggregate({
            where: { batch_id: batchId },
            _sum: { amount: true },
        }),
        prisma.weightRecords.findFirst({
            where: { batch_id: batchId },
            orderBy: [{ date: "desc" }, { created_at: "desc" }],
        }),
        prisma.itemCategory.findMany({ select: { code: true, label: true } }),
        prisma.expenseCategoryLookup.findMany({ select: { code: true, label: true } }),
    ]);
    const catLabel = new Map(categories.map((c) => [c.code, c.label]));
    const expLabel = new Map(expenseLabels.map((c) => [c.code, c.label]));
    const paid = await prisma.payment.aggregate({
        where: { ref_type: "BIRD_SALE", ref_id: { in: sales.map((s) => s.id) } },
        _sum: { amount: true },
    });

    // ── costs ──
    const lines = new Map<string, StatementLine>();
    const add = (section: Section, label: string, amount: Prisma.Decimal) => {
        if (amount.isZero()) return;
        const key = `${section}:${label}`;
        const l = lines.get(key) ?? { section, label, amount: 0 };
        l.amount = n(D(l.amount).plus(amount));
        lines.set(key, l);
    };
    const boughtOnBatch = new Set(chicks.map((c) => c.item_id));
    for (const c of chicks) add("CHICKS", "Chicks", c.total_price);
    const avg = await getItemAvgCosts([...new Set(consumed.map((c) => c.item_id))]);
    let feedKg = 0;
    let feedKgKnown = true;
    for (const c of consumed) {
        const cat = c.item.category;
        if (cat === "FEED") {
            const perKg = kgPerBaseUnit(c.item.unit, c.item.itemUnits);
            if (perKg === null) feedKgKnown = false;
            else feedKg += c.base_quantity.toNumber() * perKg;
        }
        const cost = avg.get(c.item_id);
        if (!cost || boughtOnBatch.has(c.item_id) || isNonDepleting(cat)) continue;
        const value = c.base_quantity.times(cost);
        if (cat === "FEED") add("FEED", c.item.name, value);
        else if (HEALTH.has(cat)) add("HEALTH", catLabel.get(cat) ?? cat, value);
        else add("SUPPLIES", catLabel.get(cat) ?? cat, value);
    }
    for (const e of direct) add("DIRECT", expLabel.get(e.category) ?? e.category, D(e._sum.amount));
    add("DEPRECIATION", "Equipment depreciation", D(depreciation._sum.amount));
    const costLines = [...lines.values()].sort((a, b) => b.amount - a.amount);
    const costs = costLines.reduce((s, l) => s.plus(l.amount), D(0));

    // ── shared costs ──
    let sharedTotal = 0;
    const sharedByCategory = new Map<string, number>();
    for (const m of shared) {
        const mine = m.batches.find((b) => b.batch_id === batchId);
        if (!mine || m.total === 0) continue;
        sharedTotal += mine.share;
        for (const e of m.expenses)
            sharedByCategory.set(
                e.label,
                (sharedByCategory.get(e.label) ?? 0) + (e.amount * mine.share) / m.total,
            );
    }

    // ── result ──
    const gross = sales.reduce((s, x) => s.plus(x.total_amount), D(0));
    const discounts = sales.reduce((s, x) => s.plus(x.discount_amount), D(0));
    const revenue = gross.minus(discounts);
    const contribution = revenue.minus(costs);
    const net = contribution.minus(sharedTotal);
    const due = sales.reduce((s, x) => s.plus(x.due_amount), D(0)).minus(D(paid._sum.amount));

    // ── per-unit ──
    const placed = batch.initial_chick_count;
    const diedN = died._sum.count_died ?? 0;
    const sold = sales.reduce((s, x) => s + x.birds_count, 0);
    const live = batch.houseBalances.reduce((s, b) => s + b.quantity, 0);
    const kgSold = sales.reduce((s, x) => s + x.net_weight.toNumber(), 0);
    // live birds count at their latest weighing: a running batch's kg so far
    const kgProduced =
        kgSold + (latestWeight ? (latestWeight.average_wt_grams.toNumber() * live) / 1000 : 0);
    const gainKg = kgProduced - (placed * batch.init_chicks_avg_wt) / 1000;
    const totalCost = costs.plus(sharedTotal);
    const end = batch.actual_end_date ?? new Date();

    return {
        batch: {
            id: batch.id,
            batch_code: batch.batch_code,
            breed: batch.breed,
            status: batch.status,
            starting_date: batch.starting_date,
            actual_end_date: batch.actual_end_date,
            age_days: Math.max(
                0,
                Math.floor((end.getTime() - batch.starting_date.getTime()) / 86_400_000),
            ),
        },
        revenue: { gross: n(gross), discounts: n(discounts), net: n(revenue) },
        cost_lines: costLines,
        costs: n(costs),
        contribution: n(contribution),
        shared_costs: {
            total: n(sharedTotal),
            by_category: [...sharedByCategory.entries()]
                .map(([label, amount]) => ({ label, amount: n(amount) }))
                .sort((a, b) => b.amount - a.amount),
        },
        net_profit: n(net),
        margin: revenue.isZero() ? null : Number(net.dividedBy(revenue).toFixed(4)),
        birds: { placed, died: diedN, sold, live, mortality_rate: placed > 0 ? diedN / placed : 0 },
        kg: {
            sold: Number(kgSold.toFixed(2)),
            produced: Number(kgProduced.toFixed(2)),
            feed: feedKgKnown ? Number(feedKg.toFixed(2)) : null,
        },
        per_unit: {
            cost_per_bird: placed > 0 ? n(totalCost.dividedBy(placed)) : null,
            cost_per_kg: kgProduced > 0 ? n(totalCost.dividedBy(kgProduced)) : null,
            profit_per_bird: sold > 0 ? n(net.dividedBy(sold)) : null,
            avg_price_per_kg: kgSold > 0 ? n(revenue.dividedBy(kgSold)) : null,
            fcr:
                feedKgKnown && gainKg > 0 && feedKg > 0
                    ? Number((feedKg / gainKg).toFixed(3))
                    : null,
        },
        money: { received: n(D(paid._sum.amount)), due: n(due.isNegative() ? 0 : due) },
    };
}

export type BatchStatement = Awaited<ReturnType<typeof statementFor>>;

export const BatchPnlService = {
    async statement(batchId: string) {
        return statementFor(batchId, await SharedCostService.byMonth());
    },

    /** Every batch's statement, newest first -- for the comparison table and chart. */
    async all() {
        const [shared, batches] = await Promise.all([
            SharedCostService.byMonth(),
            prisma.batches.findMany({ select: { id: true }, orderBy: { starting_date: "desc" } }),
        ]);
        return Promise.all(batches.map((b) => statementFor(b.id, shared)));
    },
};
