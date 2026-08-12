import prisma from "@lib/db";
import { Prisma } from "../../prisma/generated/prisma/client";

/**
 * Net IN-minus-OUT balance per item, in one `groupBy` instead of two
 * `aggregate` calls per item (the loop `alert.service.ts`'s checkLowStock
 * used before this was extracted). Items with no ledger rows come back
 * as zero, not missing from the map.
 */
export async function getItemBalances(itemIds: string[]): Promise<Map<string, Prisma.Decimal>> {
    const balances = new Map<string, Prisma.Decimal>();
    for (const id of itemIds) balances.set(id, new Prisma.Decimal(0));
    if (itemIds.length === 0) return balances;

    const sums = await prisma.stockLedger.groupBy({
        by: ["item_id", "direction"],
        where: { item_id: { in: itemIds } },
        _sum: { quantity: true },
    });

    for (const row of sums) {
        const quantity = row._sum.quantity ?? new Prisma.Decimal(0);
        const current = balances.get(row.item_id) ?? new Prisma.Decimal(0);
        balances.set(row.item_id, row.direction === "IN" ? current.plus(quantity) : current.minus(quantity));
    }
    return balances;
}
