import { Prisma } from "../../prisma/generated/prisma/client";

/** Equipment is used, not used up: a heater drawn for a batch is still a heater. Its cost reaches a
 * batch through AssetDepreciation, so a draw records the usage but moves no stock and costs nothing.
 * ponytail: keyed on the category code, like checkLowStock -- needs a stable flag if categories get renamed. */
export const isNonDepleting = (category: string) => category === "EQUIPMENT";

/** How much of a coded unit is left, in the item's base unit. A unit's size is its lot's base_quantity
 * split evenly across the lot's unit_count; what's been drawn is the sum of its Consumption rows.
 * `unit` is null when the lot has no unit_count yet (size unknown); `lot` is always known.
 * Call inside the transaction that will write the draw/disposal, after taking the lot lock
 * (`lockLot`), so two writers can't both see the same remainder. */
export async function codedRemaining(
    tx: Prisma.TransactionClient,
    unit_id: string,
    lot: { id: string; base_quantity: Prisma.Decimal; unit_count: number | null },
): Promise<{ unit: Prisma.Decimal | null; lot: Prisma.Decimal }> {
    const [lotDrawn, unitDrawn, disposed] = await Promise.all([
        tx.consumption.aggregate({
            where: { stock_unit: { purchase_item_id: lot.id } },
            _sum: { base_quantity: true },
        }),
        tx.consumption.aggregate({
            where: { stock_unit_id: unit_id },
            _sum: { base_quantity: true },
        }),
        // Disposals write off a unit's remainder (ref_id = the unit), which also leaves the lot. Matched
        // by reason + ref, not location: the write-off is posted where the unit was.
        tx.stockLedger.aggregate({
            where: {
                reason: "WASTAGE",
                ref_type: "ADJUSTMENT",
                ref_id: { in: await lotUnitIds(tx, lot.id) },
            },
            _sum: { quantity: true },
        }),
    ]);
    const zero = new Prisma.Decimal(0);
    const lotLeft = lot.base_quantity
        .minus(lotDrawn._sum.base_quantity ?? zero)
        .minus(disposed._sum.quantity ?? zero);
    const unitLeft =
        lot.unit_count && lot.unit_count > 0
            ? lot.base_quantity
                  .dividedBy(lot.unit_count)
                  .minus(unitDrawn._sum.base_quantity ?? zero)
            : null;
    return { unit: unitLeft, lot: lotLeft };
}

async function lotUnitIds(tx: Prisma.TransactionClient, lot_id: string) {
    return (
        await tx.stockUnit.findMany({ where: { purchase_item_id: lot_id }, select: { id: true } })
    ).map((u) => u.id);
}

/** Same per-lot lock bind() and complete() take. */
export const lockLot = (tx: Prisma.TransactionClient, lot_id: string) =>
    tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lot_id}, 0))`;

/** Where a coded unit's stock sits in the ledger: the house of its latest allocation, else the
 *  warehouse its lot was bought into. The ledger follows the unit (relocate posts a transfer), so
 *  this is also where a draw or write-off of it comes out of. */
export async function unitLocation(
    tx: Prisma.TransactionClient,
    unit_id: string,
    lot: { purchase_id: string },
): Promise<{ location_type: "WAREHOUSE" | "HOUSE"; location_id: string }> {
    const latest = await tx.stockHouseAllocation.findFirst({
        where: { stock_unit_id: unit_id },
        orderBy: { occurred_at: "desc" },
        select: { house_id: true },
    });
    if (latest?.house_id) return { location_type: "HOUSE", location_id: latest.house_id };
    const purchase = await tx.purchase.findUniqueOrThrow({
        where: { id: lot.purchase_id },
        select: { warehouse_id: true },
    });
    return { location_type: "WAREHOUSE", location_id: purchase.warehouse_id };
}

/** How much stock one coded unit carries right now, in base units: what's left in it, or for a lot
 *  with no unit_count yet, the lot's remainder split across its units still in play. Equipment is
 *  always 1. Call after `lockLot`. */
export async function unitAmount(
    tx: Prisma.TransactionClient,
    unit_id: string,
    lot: {
        id: string;
        base_quantity: Prisma.Decimal;
        unit_count: number | null;
        item: { category: string };
    },
): Promise<Prisma.Decimal> {
    if (isNonDepleting(lot.item.category)) return new Prisma.Decimal(1);
    const left = await codedRemaining(tx, unit_id, lot);
    const live = await tx.stockUnit.count({
        where: { purchase_item_id: lot.id, status: { in: ["IN_STOCK", "IN_USE"] } },
    });
    const amount = left.unit ?? (live > 0 ? left.lot.dividedBy(live) : new Prisma.Decimal(0));
    return Prisma.Decimal.max(0, Prisma.Decimal.min(amount, left.lot));
}
