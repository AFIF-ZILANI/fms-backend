import prisma from "@lib/db";
import { Prisma } from "../../prisma/generated/prisma/client";
import { getItemAvgCosts } from "@lib/stock-value";
import { chargeRatios, landedTotal } from "@lib/purchase-charges";
import { isNonDepleting } from "@lib/coded-stock";
import { PAYROLL_EXPENSE_CATEGORIES } from "@lib/paid-at-create";

/**
 * The farm's money, for the Finance overview. Profit counts what was *used*, not what was bought, the same
 * rules as the batch P&L, so the two pages agree:
 *   revenue = sales + bird sales, net of discounts
 *   costs   = chicks bought onto a batch + stock consumed (avg purchase cost; equipment excluded, it reaches
 *             a batch through depreciation) + every expense (salaries included) + depreciation + stock
 *             written off (wastage / expired / disposed)
 * Cash, receivables and payables are balances "as of" an instant, so two periods can be compared.
 *
 * ponytail: every figure is a handful of aggregate queries per period, and the monthly series repeats them
 * per month -- fine at farm scale (hundreds of rows a month). Precompute monthly rollups if it ever drags.
 */

const D = (v: Prisma.Decimal | number | string | null | undefined) => new Prisma.Decimal(v ?? 0);
const n = (d: Prisma.Decimal) => Number(d.toFixed(2));

export type CostLine = {
    kind: "CHICKS" | "STOCK" | "EXPENSE" | "DEPRECIATION" | "STOCK_LOSS";
    code: string;
    label: string;
    amount: number;
};

type Range = { from: Date; to: Date }; // [from, to)

async function categoryLabels() {
    const [items, expenses] = await Promise.all([
        prisma.itemCategory.findMany({ select: { code: true, label: true } }),
        prisma.expenseCategoryLookup.findMany({ select: { code: true, label: true } }),
    ]);
    return {
        item: new Map(items.map((c) => [c.code, c.label])),
        expense: new Map(expenses.map((c) => [c.code, c.label])),
    };
}

async function revenueIn({ from, to }: Range) {
    const [bird, regular] = await Promise.all([
        prisma.birdSale.aggregate({
            where: { sale_date: { gte: from, lt: to } },
            _sum: { total_amount: true, discount_amount: true },
        }),
        prisma.sale.aggregate({
            where: { sale_date: { gte: from, lt: to } },
            _sum: { total: true },
        }),
    ]);
    return D(bird._sum.total_amount)
        .minus(D(bird._sum.discount_amount))
        .plus(D(regular._sum.total));
}

async function costsIn(
    { from, to }: Range,
    labels: Awaited<ReturnType<typeof categoryLabels>>,
): Promise<CostLine[]> {
    const [chicks, consumed, expenses, depreciation, losses] = await Promise.all([
        prisma.purchaseItem.findMany({
            where: { batch_id: { not: null }, purchase: { purchase_date: { gte: from, lt: to } } },
            select: { purchase_id: true, total_price: true, item: { select: { category: true } } },
        }),
        prisma.consumption.findMany({
            where: { date: { gte: from, lt: to } },
            select: { item_id: true, base_quantity: true, item: { select: { category: true } } },
        }),
        prisma.expense.groupBy({
            by: ["category"],
            // A purchase charge (STOCK) is already inside stock cost via the landed average -- not again here.
            where: { date: { gte: from, lt: to }, cost_type: { not: "STOCK" } },
            _sum: { amount: true },
        }),
        prisma.assetDepreciation.aggregate({
            where: { computed_at: { gte: from, lt: to } },
            _sum: { amount: true },
        }),
        prisma.stockLedger.findMany({
            where: {
                occurred_at: { gte: from, lt: to },
                direction: "OUT",
                reason: { in: ["WASTAGE", "EXPIRED"] },
            },
            select: { item_id: true, quantity: true },
        }),
    ]);
    const avg = await getItemAvgCosts([
        ...new Set([...consumed.map((c) => c.item_id), ...losses.map((l) => l.item_id)]),
    ]);

    const ratios = await chargeRatios(chicks.map((p) => p.purchase_id));

    const lines = new Map<string, CostLine>();
    const add = (kind: CostLine["kind"], code: string, label: string, amount: Prisma.Decimal) => {
        if (amount.isZero()) return;
        const key = `${kind}:${code}`;
        const line = lines.get(key) ?? { kind, code, label, amount: 0 };
        line.amount = n(D(line.amount).plus(amount));
        lines.set(key, line);
    };
    for (const p of chicks)
        add(
            "CHICKS",
            p.item.category,
            labels.item.get(p.item.category) ?? p.item.category,
            landedTotal(p, ratios),
        );
    for (const c of consumed) {
        const cost = avg.get(c.item_id);
        if (!cost || isNonDepleting(c.item.category)) continue;
        add(
            "STOCK",
            c.item.category,
            labels.item.get(c.item.category) ?? c.item.category,
            c.base_quantity.times(cost),
        );
    }
    for (const e of expenses)
        add("EXPENSE", e.category, labels.expense.get(e.category) ?? e.category, D(e._sum.amount));
    add("DEPRECIATION", "DEPRECIATION", "Equipment depreciation", D(depreciation._sum.amount));
    const lost = losses.reduce(
        (sum, l) => sum.plus(l.quantity.times(avg.get(l.item_id) ?? 0)),
        D(0),
    );
    add("STOCK_LOSS", "STOCK_LOSS", "Stock written off", lost);
    return [...lines.values()].sort((a, b) => b.amount - a.amount);
}

/** Balances at an instant: everything dated before `at`. */
async function balancesAt(at: Date) {
    const before = { lt: at };
    const [moneyIn, moneyOut, sales, birdSales, purchases, expenses, salesPaid, purchasesPaid] =
        await Promise.all([
            prisma.payment.aggregate({
                where: { direction: "INCOMING", payment_date: before },
                _sum: { amount: true },
            }),
            prisma.payment.aggregate({
                where: { direction: "OUTGOING", payment_date: before },
                _sum: { amount: true },
            }),
            prisma.sale.aggregate({ where: { sale_date: before }, _sum: { due_amount: true } }),
            prisma.birdSale.aggregate({ where: { sale_date: before }, _sum: { due_amount: true } }),
            prisma.purchase.aggregate({
                where: { purchase_date: before },
                _sum: { due_amount: true },
            }),
            // Payroll's own expenses are settled by their payout, never owed as an expense.
            prisma.expense.aggregate({
                where: { date: before, category: { notIn: PAYROLL_EXPENSE_CATEGORIES } },
                _sum: { amount: true },
            }),
            prisma.payment.aggregate({
                where: { ref_type: { in: ["SALE", "BIRD_SALE"] }, payment_date: before },
                _sum: { amount: true },
            }),
            prisma.payment.aggregate({
                where: { ref_type: { in: ["PURCHASE", "EXPENSE"] }, payment_date: before },
                _sum: { amount: true },
            }),
        ]);
    return {
        cash: D(moneyIn._sum.amount).minus(D(moneyOut._sum.amount)),
        receivables: D(sales._sum.due_amount)
            .plus(D(birdSales._sum.due_amount))
            .minus(D(salesPaid._sum.amount)),
        payables: D(purchases._sum.due_amount)
            .plus(D(expenses._sum.amount))
            .minus(D(purchasesPaid._sum.amount)),
    };
}

async function periodFigures(range: Range) {
    const labels = await categoryLabels();
    const [revenue, costLines, end] = await Promise.all([
        revenueIn(range),
        costsIn(range, labels),
        balancesAt(range.to),
    ]);
    const costs = costLines.reduce((sum, l) => sum.plus(l.amount), D(0));
    const profit = revenue.minus(costs);
    return {
        from: range.from,
        to: range.to,
        revenue: n(revenue),
        costs: n(costs),
        net_profit: n(profit),
        margin: revenue.isZero() ? null : Number(profit.dividedBy(revenue).toFixed(4)),
        cash: n(end.cash),
        receivables: n(end.receivables),
        payables: n(end.payables),
        cost_breakdown: costLines,
    };
}

const DAY = 86_400_000;
const monthStart = (y: number, m: number) => new Date(Date.UTC(y, m, 1));
type OwedRow = { id: string; name: string; due: number; oldest: Date; records: number };

export const FinanceService = {
    /** The period and the one it's compared with -- by default the same length immediately before it. */
    async summary(q: {
        from: Date;
        to: Date;
        compare_from?: Date | undefined;
        compare_to?: Date | undefined;
    }) {
        const current: Range = { from: q.from, to: q.to };
        const len = q.to.getTime() - q.from.getTime();
        const previous: Range =
            q.compare_from && q.compare_to
                ? { from: q.compare_from, to: q.compare_to }
                : { from: new Date(q.from.getTime() - len), to: q.from };
        const [cur, prev] = await Promise.all([periodFigures(current), periodFigures(previous)]);
        return { current: cur, previous: prev };
    },

    /** One row per calendar month, oldest first, ending with the current month. */
    async monthly(months: number) {
        const now = new Date();
        const ranges = Array.from({ length: months }, (_, i) => {
            const y = now.getUTCFullYear();
            const m = now.getUTCMonth() - (months - 1 - i);
            return { from: monthStart(y, m), to: monthStart(y, m + 1) };
        });
        const labels = await categoryLabels();
        return Promise.all(
            ranges.map(async (r) => {
                const [revenue, costLines, flows, end] = await Promise.all([
                    revenueIn(r),
                    costsIn(r, labels),
                    prisma.payment.groupBy({
                        by: ["direction"],
                        where: { payment_date: { gte: r.from, lt: r.to } },
                        _sum: { amount: true },
                    }),
                    balancesAt(r.to),
                ]);
                const costs = costLines.reduce((sum, l) => sum.plus(l.amount), D(0));
                const flow = (d: "INCOMING" | "OUTGOING") =>
                    n(D(flows.find((f) => f.direction === d)?._sum.amount));
                return {
                    month: r.from.toISOString().slice(0, 7),
                    revenue: n(revenue),
                    costs: n(costs),
                    profit: n(revenue.minus(costs)),
                    cash_in: flow("INCOMING"),
                    cash_out: flow("OUTGOING"),
                    cash_end: n(end.cash),
                };
            }),
        );
    },

    /** What is owed right now, both ways, grouped by who and by age (days since the bill's date). */
    async owed(top: number) {
        const now = Date.now();
        const [sales, birdSales, purchases, expenses, paid, customers, suppliers, expenseLabels] =
            await Promise.all([
                prisma.sale.findMany({
                    select: { id: true, customer_id: true, sale_date: true, due_amount: true },
                }),
                prisma.birdSale.findMany({
                    select: { id: true, customer_id: true, sale_date: true, due_amount: true },
                }),
                prisma.purchase.findMany({
                    select: { id: true, supplier_id: true, purchase_date: true, due_amount: true },
                }),
                prisma.expense.findMany({
                    where: { category: { notIn: PAYROLL_EXPENSE_CATEGORIES } },
                    select: { id: true, category: true, date: true, amount: true },
                }),
                prisma.payment.groupBy({ by: ["ref_id"], _sum: { amount: true } }),
                prisma.customers.findMany({
                    select: { id: true, profile: { select: { name: true } } },
                }),
                prisma.suppliers.findMany({
                    select: { id: true, profile: { select: { name: true } } },
                }),
                prisma.expenseCategoryLookup.findMany({ select: { code: true, label: true } }),
            ]);
        const paidBy = new Map(paid.map((p) => [p.ref_id, D(p._sum.amount)]));
        const customerName = new Map(customers.map((c) => [c.id, c.profile.name]));
        const supplierName = new Map(suppliers.map((s) => [s.id, s.profile.name]));
        const expenseName = new Map(expenseLabels.map((e) => [e.code, e.label]));

        const tally = (
            records: { key: string; name: string; date: Date; due: Prisma.Decimal }[],
        ) => {
            const buckets = { d0_30: D(0), d31_60: D(0), d60_plus: D(0) };
            const byWho = new Map<string, OwedRow>();
            for (const r of records) {
                if (!r.due.greaterThan(0)) continue;
                const age = (now - r.date.getTime()) / DAY;
                const bucket = age <= 30 ? "d0_30" : age <= 60 ? "d31_60" : "d60_plus";
                buckets[bucket] = buckets[bucket].plus(r.due);
                const row = byWho.get(r.key) ?? {
                    id: r.key,
                    name: r.name,
                    due: 0,
                    oldest: r.date,
                    records: 0,
                };
                row.due = n(D(row.due).plus(r.due));
                row.records += 1;
                if (r.date < row.oldest) row.oldest = r.date;
                byWho.set(r.key, row);
            }
            const rows = [...byWho.values()].sort((a, b) => b.due - a.due);
            return {
                total: n(buckets.d0_30.plus(buckets.d31_60).plus(buckets.d60_plus)),
                buckets: {
                    d0_30: n(buckets.d0_30),
                    d31_60: n(buckets.d31_60),
                    d60_plus: n(buckets.d60_plus),
                },
                count: rows.length,
                top: rows.slice(0, top),
            };
        };

        const left = (id: string, due: Prisma.Decimal) => due.minus(paidBy.get(id) ?? 0);
        return {
            receivables: tally(
                [
                    ...sales.map((s) => ({ ...s, date: s.sale_date })),
                    ...birdSales.map((s) => ({ ...s, date: s.sale_date })),
                ].map((s) => ({
                    key: s.customer_id ?? "walk-in",
                    name: s.customer_id
                        ? (customerName.get(s.customer_id) ?? "Unknown customer")
                        : "Walk-in buyers",
                    date: s.date,
                    due: left(s.id, s.due_amount),
                })),
            ),
            payables: tally([
                ...purchases.map((p) => ({
                    key: p.supplier_id ?? "no-supplier",
                    name: p.supplier_id
                        ? (supplierName.get(p.supplier_id) ?? "Unknown supplier")
                        : "No supplier named",
                    date: p.purchase_date,
                    due: left(p.id, p.due_amount),
                })),
                ...expenses.map((e) => ({
                    key: `expense:${e.category}`,
                    name: `${expenseName.get(e.category) ?? e.category} (expense)`,
                    date: e.date,
                    due: left(e.id, e.amount),
                })),
            ]),
        };
    },
};
