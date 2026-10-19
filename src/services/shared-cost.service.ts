import prisma from "@lib/db";
import { birdDaysByMonth } from "@lib/bird-days";

/**
 * Farm-wide running costs (cost_type SHARED_PERIOD: electricity, rent, internet...) shared out between the
 * batches that were on the farm when they were incurred, in proportion to bird-days in the expense's
 * calendar month. A month with no birds keeps its shared costs as farm overhead -- nothing to share them with.
 *
 * Computed on read, never stored: a late mortality entry or a re-dated sale changes the bird-days, and the
 * split follows. SHARED_CAPITAL (buildings, big equipment) isn't a running cost and isn't shared here.
 */
export type BatchShare = { batch_id: string; batch_code: string; bird_days: number; share: number };
export type SharedMonth = {
    month: string;
    total: number;
    allocated: number;
    overhead: number;
    bird_days: number;
    batches: BatchShare[];
    expenses: {
        id: string;
        date: Date;
        category: string;
        label: string;
        amount: number;
        remarks: string | null;
    }[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Splits `amount` by weights, in whole paisa, with the rounding remainder on the largest share so the parts add up exactly. */
export function splitByWeight(amount: number, weights: Map<string, number>): Map<string, number> {
    const total = [...weights.values()].reduce((a, b) => a + b, 0);
    const out = new Map<string, number>();
    if (total <= 0) return out;
    let given = 0;
    let largest = "";
    for (const [k, w] of weights) {
        const part = r2((amount * w) / total);
        out.set(k, part);
        given = r2(given + part);
        if (!largest || w > (weights.get(largest) ?? 0)) largest = k;
    }
    out.set(largest, r2((out.get(largest) ?? 0) + amount - given));
    return out;
}

export const SharedCostService = {
    async byMonth(): Promise<SharedMonth[]> {
        const [expenses, birdDays, batches, labels] = await Promise.all([
            prisma.expense.findMany({
                where: { cost_type: "SHARED_PERIOD" },
                orderBy: { date: "asc" },
            }),
            birdDaysByMonth(),
            prisma.batches.findMany({ select: { id: true, batch_code: true } }),
            prisma.expenseCategoryLookup.findMany({ select: { code: true, label: true } }),
        ]);
        const code = new Map(batches.map((b) => [b.id, b.batch_code]));
        const label = new Map(labels.map((l) => [l.code, l.label]));

        const months = new Map<string, SharedMonth>();
        for (const e of expenses) {
            const month = e.date.toISOString().slice(0, 7);
            const row =
                months.get(month) ??
                ({
                    month,
                    total: 0,
                    allocated: 0,
                    overhead: 0,
                    bird_days: 0,
                    batches: [],
                    expenses: [],
                } as SharedMonth);
            const amount = Number(e.amount);
            row.total = r2(row.total + amount);
            row.expenses.push({
                id: e.id,
                date: e.date,
                category: e.category,
                label: label.get(e.category) ?? e.category,
                amount,
                remarks: e.remarks,
            });
            months.set(month, row);
        }
        for (const row of months.values()) {
            const weights = birdDays.get(row.month) ?? new Map<string, number>();
            row.bird_days = [...weights.values()].reduce((a, b) => a + b, 0);
            const parts = splitByWeight(row.total, weights);
            row.batches = [...parts.entries()]
                .map(([batch_id, share]) => ({
                    batch_id,
                    batch_code: code.get(batch_id) ?? "—",
                    bird_days: weights.get(batch_id) ?? 0,
                    share,
                }))
                .sort((a, b) => b.share - a.share);
            row.allocated = r2(row.batches.reduce((s, b) => s + b.share, 0));
            row.overhead = r2(row.total - row.allocated);
        }
        return [...months.values()].sort((a, b) => b.month.localeCompare(a.month));
    },

    /** One batch's share of every shared cost, by expense category. */
    async forBatch(batchId: string) {
        const months = await SharedCostService.byMonth();
        const byCategory = new Map<string, { label: string; amount: number }>();
        let total = 0;
        for (const m of months) {
            const mine = m.batches.find((b) => b.batch_id === batchId);
            if (!mine || m.total === 0) continue;
            total = r2(total + mine.share);
            // the batch's share of each expense in that month, in the same proportion
            for (const [category, amount] of groupBy(m.expenses)) {
                const line = byCategory.get(category.code) ?? { label: category.label, amount: 0 };
                line.amount = r2(line.amount + (amount * mine.share) / m.total);
                byCategory.set(category.code, line);
            }
        }
        return {
            total,
            by_category: [...byCategory.entries()].map(([code, v]) => ({ code, ...v })),
        };
    },
};

function groupBy(expenses: SharedMonth["expenses"]) {
    const out = new Map<string, number>();
    const keys = new Map<string, { code: string; label: string }>();
    for (const e of expenses) {
        const k = keys.get(e.category) ?? { code: e.category, label: e.label };
        keys.set(e.category, k);
        out.set(e.category, (out.get(e.category) ?? 0) + e.amount);
    }
    return [...out.entries()].map(([c, amount]) => [keys.get(c)!, amount] as const);
}
