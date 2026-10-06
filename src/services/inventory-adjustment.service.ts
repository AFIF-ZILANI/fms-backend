import prisma from "@lib/db";
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
                // An opening balance means "this is what was here when we started": on a location
                // that already holds recorded stock it would silently become a count correction.
                if (data.reason === "Opening balance" && !current.isZero()) {
                    throw AppError.conflict(
                        "Stock is already recorded here -- use a count correction instead of an opening balance",
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

                return adjustment;
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },
};
