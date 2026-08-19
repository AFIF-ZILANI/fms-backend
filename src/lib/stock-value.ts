import prisma from "@lib/db";
import { Prisma } from "../../prisma/generated/prisma/client";

/**
 * Weighted-average cost per base unit, derived from purchase history --
 * StockLedger.unit_cost is never populated by any write path (see
 * consumption.service.ts / inventory-adjustment.service.ts), so PurchaseItem
 * is the only real cost basis in this system. sum(total_price)/sum(base_quantity)
 * across every purchase line for that item -- base_quantity (not the raw
 * entered quantity) so a mix of units across purchases (e.g. one line in BAG,
 * another in KG) still averages correctly. Items never purchased are absent
 * from the map -- callers must treat missing as "unknown cost", not zero.
 */
export async function getItemAvgCosts(itemIds: string[]): Promise<Map<string, Prisma.Decimal>> {
    if (itemIds.length === 0) return new Map();
    const grouped = await prisma.purchaseItem.groupBy({
        by: ["item_id"],
        where: { item_id: { in: itemIds } },
        _sum: { base_quantity: true, total_price: true },
    });

    const costs = new Map<string, Prisma.Decimal>();
    for (const row of grouped) {
        const baseQuantity = row._sum.base_quantity ?? new Prisma.Decimal(0);
        const totalPrice = row._sum.total_price ?? new Prisma.Decimal(0);
        if (baseQuantity.isZero()) continue;
        costs.set(row.item_id, totalPrice.div(baseQuantity));
    }
    return costs;
}
