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

/** Current balance per item at one location, e.g. "what's on hand at House 3 right now" --
 * only entries tagged with this exact location_type+location_id count. Untagged StockLedger
 * rows (most historical data, predating this feature) are never counted toward any location. */
export async function getLocationStock(
    location_type: "WAREHOUSE" | "HOUSE",
    location_id: string,
): Promise<{ item_id: string; balance: Prisma.Decimal }[]> {
    const sums = await prisma.stockLedger.groupBy({
        by: ["item_id", "direction"],
        where: { location_type, location_id },
        _sum: { quantity: true },
    });

    const balances = new Map<string, Prisma.Decimal>();
    for (const row of sums) {
        const quantity = row._sum.quantity ?? new Prisma.Decimal(0);
        const current = balances.get(row.item_id) ?? new Prisma.Decimal(0);
        balances.set(row.item_id, row.direction === "IN" ? current.plus(quantity) : current.minus(quantity));
    }
    return Array.from(balances.entries()).map(([item_id, balance]) => ({ item_id, balance }));
}

/** Same balance as getLocationStock, for one item at one location, inside an in-flight
 * transaction -- for a write that needs to validate against the current balance before
 * posting (Transfer checking warehouse stock, Consumption checking house stock) without a
 * race between the check and the write. */
export async function getItemLocationBalance(
    tx: Prisma.TransactionClient,
    item_id: string,
    location_type: "WAREHOUSE" | "HOUSE",
    location_id: string,
): Promise<Prisma.Decimal> {
    const sums = await tx.stockLedger.groupBy({
        by: ["direction"],
        where: { item_id, location_type, location_id },
        _sum: { quantity: true },
    });
    let balance = new Prisma.Decimal(0);
    for (const row of sums) {
        const quantity = row._sum.quantity ?? new Prisma.Decimal(0);
        balance = row.direction === "IN" ? balance.plus(quantity) : balance.minus(quantity);
    }
    return balance;
}
