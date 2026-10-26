import prisma from "@lib/db";
import { Prisma } from "../../prisma/generated/prisma/client";

/**
 * Landed cost: a purchase's own charges (Expense cost_type STOCK -- transport, labour) are split
 * over its lines by value, so a line's real cost is total_price × (1 + ratio) where
 * ratio = charges ÷ the purchase's line total. Computed on read: a charge added later re-costs
 * stock already consumed, so batch P&L always shows the real cost.
 *
 * ponytail: a purchase whose lines total 0 (all free) can't carry its charges by value, so they're
 * dropped from stock cost; split by quantity if that ever happens for real.
 */
export async function chargeRatios(
    purchaseIds: string[],
): Promise<Map<string, Prisma.Decimal>> {
    const ids = [...new Set(purchaseIds)];
    if (ids.length === 0) return new Map();
    const charges = await prisma.expense.groupBy({
        by: ["purchase_id"],
        where: { purchase_id: { in: ids }, cost_type: "STOCK" },
        _sum: { amount: true },
    });
    if (charges.length === 0) return new Map();
    const lineTotals = await prisma.purchaseItem.groupBy({
        by: ["purchase_id"],
        where: { purchase_id: { in: charges.map((c) => c.purchase_id!) } },
        _sum: { total_price: true },
    });
    const totalBy = new Map(lineTotals.map((l) => [l.purchase_id, l._sum.total_price]));
    const ratios = new Map<string, Prisma.Decimal>();
    for (const c of charges) {
        const total = totalBy.get(c.purchase_id!);
        if (!total || total.isZero() || !c._sum.amount) continue;
        ratios.set(c.purchase_id!, c._sum.amount.dividedBy(total));
    }
    return ratios;
}

/** A line's cost including its share of the purchase's charges. */
export function landedTotal(
    line: { purchase_id: string; total_price: Prisma.Decimal },
    ratios: Map<string, Prisma.Decimal>,
): Prisma.Decimal {
    const ratio = ratios.get(line.purchase_id);
    return ratio ? line.total_price.times(ratio.plus(1)) : line.total_price;
}
