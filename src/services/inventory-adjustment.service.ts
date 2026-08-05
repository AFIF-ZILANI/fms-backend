import prisma from "@lib/db";
import { Prisma } from "../../prisma/generated/prisma/client";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import { StockLedgerService } from "@services/stock-ledger.service";
import type {
    CreateInventoryAdjustmentInput,
    ListInventoryAdjustmentsQuery,
} from "@validators/inventory-adjustment.validator";

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
     * transaction -- direction follows the sign of the correction. */
    async create(data: CreateInventoryAdjustmentInput) {
        const before = new Prisma.Decimal(data.quantity_before);
        const after = new Prisma.Decimal(data.quantity_after);
        const delta = after.minus(before);
        if (delta.isZero()) {
            throw AppError.badRequest("quantity_after must differ from quantity_before");
        }

        try {
            return await prisma.$transaction(async (tx) => {
                const adjustment = await tx.inventoryAdjustment.create({
                    data: {
                        item_id: data.item_id,
                        quantity_before: before,
                        quantity_after: after,
                        adjustment_quantity: delta,
                        reason: data.reason,
                        recorded_by_id: data.recorded_by_id,
                        idempotency_key: data.idempotency_key ?? crypto.randomUUID(),
                        ...(data.warehouse_id !== undefined && { warehouse_id: data.warehouse_id }),
                        ...(data.house_id !== undefined && { house_id: data.house_id }),
                        ...(data.note !== undefined && { note: data.note }),
                    },
                    include: { item: true },
                });

                await StockLedgerService.record(tx, {
                    item_id: data.item_id,
                    quantity: delta.abs(),
                    direction: delta.isPositive() ? "IN" : "OUT",
                    reason: "ADJUSTMENT",
                    ref_type: "ADJUSTMENT",
                    ref_id: adjustment.id,
                });

                return adjustment;
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },
};
