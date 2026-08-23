import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import { toBaseQuantity } from "@lib/unit-conversion";
import { getItemLocationBalance } from "@lib/stock-balance";
import { StockLedgerService } from "@services/stock-ledger.service";
import type {
    CreateConsumptionInput,
    ListConsumptionsQuery,
} from "@validators/consumption.validator";

export const ConsumptionService = {
    async getAll(query: ListConsumptionsQuery) {
        const where = {
            ...(query.batch_id !== undefined && { batch_id: query.batch_id }),
            ...(query.house_id !== undefined && { house_id: query.house_id }),
            ...(query.item_id !== undefined && { item_id: query.item_id }),
            ...((query.occurred_from !== undefined || query.occurred_to !== undefined) && {
                date: {
                    ...(query.occurred_from !== undefined && { gte: query.occurred_from }),
                    ...(query.occurred_to !== undefined && { lte: query.occurred_to }),
                },
            }),
        };
        const [consumptions, total] = await Promise.all([
            prisma.consumption.findMany({
                where,
                include: { batch: true, house: true, item: true, stock_unit: true },
                orderBy: { date: "desc" },
                ...toSkipTake(query),
            }),
            prisma.consumption.count({ where }),
        ]);
        return { consumptions, meta: buildMeta(total, query) };
    },

    /** Two draw paths, branching on stock_unit_id:
     *  - coded (medicine/vaccine/equipment): decrements StockUnit.remaining_quantity,
     *    flips status IN_STOCK -> IN_USE, or -> CONSUMED once it hits zero.
     *    Equipment (remaining_quantity null) just flips to IN_USE once, non-depleting.
     *  - aggregate (feed etc.): no StockUnit to decrement.
     *  Both paths post a StockLedger OUT entry, symmetric with purchase.service.ts's
     *  unconditional StockLedger IN -- otherwise coded draws never leave the ledger,
     *  which breaks low-stock checks for medicine/vaccine/equipment.
     *  Both paths use base_quantity (data.quantity converted to Item.unit via
     *  toBaseQuantity), never the raw entered quantity -- StockUnit.remaining_quantity
     *  and StockLedger are always in the item's base unit. */
    async create(data: CreateConsumptionInput) {
        try {
            return await prisma.$transaction(async (tx) => {
                const base_quantity = await toBaseQuantity(
                    tx,
                    data.item_id,
                    data.unit,
                    data.quantity,
                    "USABLE",
                );

                if (data.stock_unit_id !== undefined) {
                    const unitId = data.stock_unit_id;
                    const unit = await tx.stockUnit.findUnique({ where: { id: unitId } });
                    if (!unit) throw AppError.notFound("StockUnit");
                    if (unit.status !== "IN_STOCK" && unit.status !== "IN_USE") {
                        throw AppError.conflict(
                            `StockUnit is ${unit.status.toLowerCase()}, cannot draw from it`,
                        );
                    }

                    if (unit.remaining_quantity !== null) {
                        if (unit.remaining_quantity.lessThan(base_quantity)) {
                            throw AppError.conflict(
                                "Consumption quantity exceeds remaining stock in this unit",
                            );
                        }
                        const remaining = unit.remaining_quantity.minus(base_quantity);
                        await tx.stockUnit.update({
                            where: { id: unitId },
                            data: {
                                remaining_quantity: remaining,
                                status: remaining.isZero() ? "CONSUMED" : "IN_USE",
                            },
                        });
                    } else if (unit.status === "IN_STOCK") {
                        await tx.stockUnit.update({
                            where: { id: unitId },
                            data: { status: "IN_USE" },
                        });
                    }
                } else {
                    // Aggregate (non-coded) draw -- must not exceed what's actually been
                    // transferred to this house and not yet used.
                    const available = await getItemLocationBalance(tx, data.item_id, "HOUSE", data.house_id);
                    if (available.lessThan(base_quantity)) {
                        throw AppError.conflict(
                            `Only ${available.toString()} of this item is on hand at this house`,
                        );
                    }
                }

                const consumption = await tx.consumption.create({
                    data: {
                        house_id: data.house_id,
                        item_id: data.item_id,
                        quantity: data.quantity,
                        unit: data.unit,
                        base_quantity,
                        date: data.date,
                        recorded_by_id: data.recorded_by_id,
                        idempotency_key: data.idempotency_key ?? crypto.randomUUID(),
                        ...(data.batch_id !== undefined && { batch_id: data.batch_id }),
                        ...(data.stock_unit_id !== undefined && {
                            stock_unit_id: data.stock_unit_id,
                        }),
                        ...(data.note !== undefined && { note: data.note }),
                    },
                });

                await StockLedgerService.record(tx, {
                    item_id: data.item_id,
                    quantity: base_quantity,
                    direction: "OUT",
                    reason: "CONSUMPTION",
                    ref_type: "CONSUMPTION",
                    ref_id: consumption.id,
                    location_type: "HOUSE",
                    location_id: data.house_id,
                });

                return consumption;
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },
};
