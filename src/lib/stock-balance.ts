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

/** On-hand balance per (item, location) across every warehouse and house, folded IN-OUT,
 * with the location's name resolved. One grouped query for the whole catalog -- the item
 * catalog's warehouse/house stock columns and their drill-down sheets all read from this.
 * DISPOSAL and untagged (null-location) rows are excluded: neither is stock sitting at a
 * warehouse or house. Only positive balances are returned.
 * ponytail: one groupBy over the full ledger; fine at farm scale (dozens of items x locations).
 * If the ledger grows huge, add an item_id filter and call it per catalog page. */
export async function getStockByLocation(): Promise<
    {
        item_id: string;
        location_type: "WAREHOUSE" | "HOUSE";
        location_id: string;
        location_name: string;
        balance: Prisma.Decimal;
    }[]
> {
    const sums = await prisma.stockLedger.groupBy({
        by: ["item_id", "location_type", "location_id", "direction"],
        where: { location_type: { in: ["WAREHOUSE", "HOUSE"] }, location_id: { not: null } },
        _sum: { quantity: true },
    });

    const balances = new Map<
        string,
        { item_id: string; location_type: "WAREHOUSE" | "HOUSE"; location_id: string; balance: Prisma.Decimal }
    >();
    for (const row of sums) {
        const location_type = row.location_type as "WAREHOUSE" | "HOUSE";
        const location_id = row.location_id!;
        const key = `${row.item_id}|${location_type}|${location_id}`;
        const entry =
            balances.get(key) ?? { item_id: row.item_id, location_type, location_id, balance: new Prisma.Decimal(0) };
        const quantity = row._sum.quantity ?? new Prisma.Decimal(0);
        entry.balance = row.direction === "IN" ? entry.balance.plus(quantity) : entry.balance.minus(quantity);
        balances.set(key, entry);
    }

    const positive = Array.from(balances.values()).filter((b) => b.balance.greaterThan(0));

    // UUIDs never collide across the two tables, so one id->name map is safe.
    const [warehouses, houses] = await Promise.all([
        prisma.warehouses.findMany({
            where: { id: { in: positive.filter((b) => b.location_type === "WAREHOUSE").map((b) => b.location_id) } },
            select: { id: true, name: true },
        }),
        prisma.houses.findMany({
            where: { id: { in: positive.filter((b) => b.location_type === "HOUSE").map((b) => b.location_id) } },
            select: { id: true, name: true },
        }),
    ]);
    const nameById = new Map<string, string>();
    for (const w of warehouses) nameById.set(w.id, w.name);
    for (const h of houses) nameById.set(h.id, h.name);

    return positive.map((b) => ({ ...b, location_name: nameById.get(b.location_id) ?? "Unknown" }));
}

/** Same balance as getLocationStock, for one item at one location, inside an in-flight
 * transaction -- for a write that needs to validate against the current balance before
 * posting (Transfer checking warehouse stock, Consumption checking house stock). Reading
 * inside the same transaction as the write narrows the window vs. a pre-transaction read;
 * it is not serializable under Postgres READ COMMITTED (Prisma's interactive transaction
 * default), so a concurrent write can still oversubscribe in principle -- same accepted
 * risk as the existing coded StockUnit draw path. */
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
