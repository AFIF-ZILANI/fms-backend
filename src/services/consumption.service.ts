import prisma from "@lib/db";
import { Prisma } from "../../prisma/generated/prisma/client";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
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
        };
        const [consumptions, total] = await Promise.all([
            prisma.consumption.findMany({
                where,
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
     *  - aggregate (feed etc.): no StockUnit -- writes a StockLedger OUT entry instead. */
    async create(data: CreateConsumptionInput) {
        try {
            return await prisma.$transaction(async (tx) => {
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
                        const quantity = new Prisma.Decimal(data.quantity);
                        if (unit.remaining_quantity.lessThan(quantity)) {
                            throw AppError.conflict(
                                "Consumption quantity exceeds remaining stock in this unit",
                            );
                        }
                        const remaining = unit.remaining_quantity.minus(quantity);
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
                }

                const consumption = await tx.consumption.create({
                    data: {
                        house_id: data.house_id,
                        item_id: data.item_id,
                        quantity: data.quantity,
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

                if (data.stock_unit_id === undefined) {
                    await StockLedgerService.record(tx, {
                        item_id: data.item_id,
                        quantity: data.quantity,
                        direction: "OUT",
                        reason: "CONSUMPTION",
                        ref_type: "CONSUMPTION",
                        ref_id: consumption.id,
                    });
                }

                return consumption;
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },
};
