import prisma from "@lib/db";
import { Prisma } from "../../prisma/generated/prisma/client";
import { chargeRatios, landedTotal } from "@lib/purchase-charges";

/**
 * Weighted-average cost per base unit, derived from purchase history --
 * StockLedger.unit_cost is written only on a purchase's own IN rows (purchase.service.ts), not on
 * consumption, transfer or adjustment rows, so it can't be averaged across the ledger; PurchaseItem
 * is the cost basis. sum(landed total_price)/sum(base_quantity) -- landed = plus the line's share
 * of its purchase's charges (lib/purchase-charges.ts)
 * across every purchase line for that item -- base_quantity (not the raw
 * entered quantity) so a mix of units across purchases (e.g. one line in BAG,
 * another in KG) still averages correctly. Items never purchased are absent
 * from the map -- callers must treat missing as "unknown cost", not zero.
 *
 * Opening balances with a value (their OPENING_BALANCE ledger row's unit_cost) count as one more
 * "purchase" at that price for their quantity -- the only cost basis an item that was never bought has.
 */
export async function getItemAvgCosts(itemIds: string[]): Promise<Map<string, Prisma.Decimal>> {
    if (itemIds.length === 0) return new Map();
    const lines = await prisma.purchaseItem.findMany({
        // Opening lots are zero-cost placeholders, not a price paid -- they'd drag the average down.
        where: { item_id: { in: itemIds }, purchase: { is_opening: false } },
        select: { item_id: true, purchase_id: true, base_quantity: true, total_price: true },
    });
    // Each line at its landed cost: goods plus its by-value share of the purchase's charges.
    const ratios = await chargeRatios(lines.map((l) => l.purchase_id));

    const openings = await prisma.stockLedger.findMany({
        where: {
            item_id: { in: itemIds },
            reason: "OPENING_BALANCE",
            direction: "IN",
            unit_cost: { not: null },
        },
        select: { item_id: true, quantity: true, unit_cost: true },
    });

    const sums = new Map<string, { qty: Prisma.Decimal; cost: Prisma.Decimal }>();
    const add = (item_id: string, qty: Prisma.Decimal, cost: Prisma.Decimal) => {
        const s = sums.get(item_id) ?? { qty: new Prisma.Decimal(0), cost: new Prisma.Decimal(0) };
        s.qty = s.qty.plus(qty);
        s.cost = s.cost.plus(cost);
        sums.set(item_id, s);
    };
    for (const line of lines) add(line.item_id, line.base_quantity, landedTotal(line, ratios));
    for (const o of openings) add(o.item_id, o.quantity, o.quantity.times(o.unit_cost!));
    const costs = new Map<string, Prisma.Decimal>();
    for (const [itemId, s] of sums) {
        if (s.qty.isZero()) continue;
        costs.set(itemId, s.cost.div(s.qty));
    }
    return costs;
}
