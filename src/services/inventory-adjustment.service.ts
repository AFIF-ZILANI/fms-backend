import prisma from "@lib/db";
import { audit } from "@lib/audit";
import { Prisma } from "../../prisma/generated/prisma/client";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import { StockLedgerService } from "@services/stock-ledger.service";
import { getItemLocationBalance } from "@lib/stock-balance";
import type {
    CreateInventoryAdjustmentInput,
    ListInventoryAdjustmentsQuery,
} from "@validators/inventory-adjustment.validator";

/** The free-text reasons the clients offer, mapped onto the ledger's own reasons so wastage
 * and expiry reports see them. Anything else (a recount, "damaged stock") stays ADJUSTMENT. */
const LEDGER_REASON: Record<string, "WASTAGE" | "EXPIRED" | "OPENING_BALANCE"> = {
    Wastage: "WASTAGE",
    Expired: "EXPIRED",
    "Opening balance": "OPENING_BALANCE",
};

/** The zero-cost "Opening stock" lot behind a QR-tracked item's opening balance (see Purchase.is_opening):
 * StockUnit only binds to a PurchaseItem, so without it the item's bottles could never be linked.
 * Writes no ledger row -- the opening balance's own adjustment already posted the stock. Also used by
 * scripts/backfill-opening-lots.ts for opening balances recorded before this existed. */
export async function createOpeningLot(
    tx: Prisma.TransactionClient,
    lot: {
        item_id: string;
        unit: string;
        quantity: Prisma.Decimal;
        warehouse_id: string;
        recorded_by_id: string;
        date: Date;
    },
) {
    return tx.purchase.create({
        data: {
            is_opening: true,
            warehouse_id: lot.warehouse_id,
            invoice_no: "Opening stock",
            purchase_date: lot.date,
            total_amount: 0,
            paid_amount: 0,
            due_amount: 0,
            recorded_by_id: lot.recorded_by_id,
            items: {
                create: {
                    item_id: lot.item_id,
                    quantity: lot.quantity,
                    unit: lot.unit,
                    base_quantity: lot.quantity,
                    unit_price: 0,
                    total_price: 0,
                },
            },
        },
    });
}

export const InventoryAdjustmentService = {
    async getAll(query: ListInventoryAdjustmentsQuery) {
        const where = { ...(query.item_id !== undefined && { item_id: query.item_id }) };
        const [adjustments, total] = await Promise.all([
            prisma.inventoryAdjustment.findMany({
                where,
                include: { item: true },
                orderBy: { created_at: "desc" },
                ...toSkipTake(query),
            }),
            prisma.inventoryAdjustment.count({ where }),
        ]);
        return { adjustments, meta: buildMeta(total, query) };
    },

    /** Writes the adjustment row and a matching StockLedger entry in one
     * transaction -- direction follows the sign of the correction. The "before" figure is
     * read from the ledger inside the transaction, never taken from the client: a stale or
     * mistyped figure would post the wrong delta and leave the ledger permanently off. */
    async create(data: CreateInventoryAdjustmentInput) {
        // house wins if the caller somehow set both (the web does when both are picked).
        const location_type = data.house_id !== undefined ? ("HOUSE" as const) : ("WAREHOUSE" as const);
        const location_id = (data.house_id ?? data.warehouse_id)!;
        const after = new Prisma.Decimal(data.quantity_after);

        try {
            return await prisma.$transaction(async (tx) => {
                const current = await getItemLocationBalance(
                    tx,
                    data.item_id,
                    location_type,
                    location_id,
                );
                // An opening balance means "this is what was here when we started": once the item has
                // any ledger entry anywhere (a purchase, an earlier opening balance) its stock is
                // already being tracked, and a second "start" would double-count it.
                if (
                    data.reason === "Opening balance" &&
                    (await tx.stockLedger.findFirst({ where: { item_id: data.item_id }, select: { id: true } }))
                ) {
                    throw AppError.conflict(
                        "This item already has stock history -- use a count correction instead of an opening balance",
                    );
                }
                const item = await tx.item.findUniqueOrThrow({
                    where: { id: data.item_id },
                    select: { unit: true, is_unit_tracked: true },
                });
                const needsOpeningLot = data.reason === "Opening balance" && item.is_unit_tracked;
                // A lot always lands in a warehouse (Purchase.warehouse_id); bottles reach a house by
                // allocation once their codes are linked.
                if (needsOpeningLot && location_type === "HOUSE") {
                    throw AppError.badRequest(
                        "A QR-tracked item's opening balance goes in a warehouse -- link the codes, then allocate the bottles to the house",
                    );
                }
                const before = current;
                const delta = after.minus(before);
                if (delta.isZero()) {
                    throw AppError.badRequest("The count matches the current balance -- nothing to adjust");
                }

                const adjustment = await tx.inventoryAdjustment.create({
                    data: {
                        item_id: data.item_id,
                        quantity_before: before,
                        quantity_after: after,
                        adjustment_quantity: delta,
                        reason: data.reason,
                        recorded_by_id: data.recorded_by_id,
                        idempotency_key: data.idempotency_key ?? crypto.randomUUID(),
                        // Only the location actually used, so the row can't say two things.
                        ...(location_type === "HOUSE"
                            ? { house_id: location_id }
                            : { warehouse_id: location_id }),
                        ...(data.note !== undefined && { note: data.note }),
                    },
                    include: { item: true },
                });

                await StockLedgerService.record(tx, {
                    item_id: data.item_id,
                    quantity: delta.abs(),
                    direction: delta.isPositive() ? "IN" : "OUT",
                    reason: LEDGER_REASON[data.reason] ?? "ADJUSTMENT",
                    ref_type: "ADJUSTMENT",
                    ref_id: adjustment.id,
                    location_type,
                    location_id,
                });

                if (needsOpeningLot) {
                    await createOpeningLot(tx, {
                        item_id: data.item_id,
                        unit: item.unit,
                        quantity: after,
                        warehouse_id: location_id,
                        recorded_by_id: data.recorded_by_id,
                        date: adjustment.created_at,
                    });
                }

                await audit(tx, {
                    table: "InventoryAdjustment",
                    record_id: adjustment.id,
                    action: "CREATE",
                    actor_id: data.recorded_by_id,
                    note: `Stock adjusted: ${data.reason}`,
                    before: { item_id: data.item_id, quantity: before.toString() },
                    after: { item_id: data.item_id, quantity: after.toString(), location_type, location_id },
                });

                return adjustment;
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },
};
