import prisma from "@lib/db";
import { assertHouseActive } from "@lib/active-guards";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import { toBaseQuantity } from "@lib/unit-conversion";
import { getItemLocationBalance } from "@lib/stock-balance";
import { StockLedgerService } from "@services/stock-ledger.service";
import { assertUnitInHouse, codedRemaining, isNonDepleting, lockLot } from "@lib/coded-stock";
import type {
    CreateConsumptionInput,
    ListConsumptionsQuery,
} from "@validators/consumption.validator";
import type {
    StockActivitySummary,
    StockActivitySummaryQuery,
} from "@validators/stock-activity.validator";

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
                include: {
                    batch: true,
                    house: true,
                    item: true,
                    stock_unit: true,
                    recorded_by: { select: { id: true, name: true } },
                },
                orderBy: { date: "desc" },
                ...toSkipTake(query),
            }),
            prisma.consumption.count({ where }),
        ]);
        return { consumptions, meta: buildMeta(total, query) };
    },

    /** What a house has used: draws in all, today, this week, across how many items, and the latest. */
    async summary(query: StockActivitySummaryQuery): Promise<StockActivitySummary> {
        const where = { house_id: query.house_id };
        const [total, today, week, items, latest] = await Promise.all([
            prisma.consumption.count({ where }),
            prisma.consumption.count({ where: { ...where, date: { gte: query.today_from } } }),
            prisma.consumption.count({ where: { ...where, date: { gte: query.week_from } } }),
            prisma.consumption.groupBy({ by: ["item_id"], where }),
            prisma.consumption.aggregate({ where, _max: { date: true } }),
        ]);
        return { total, today, week, items: items.length, last_at: latest._max.date };
    },

    /** Two draw paths, branching on stock_unit_id:
     *  - coded (medicine/vaccine/equipment): flips StockUnit status BOUND -> IN_USE on first
     *    use. StockUnit no longer tracks quantity, so there is no per-unit remaining/overdraw
     *    check and no auto-CONSUMED (dropped with the qty columns); CONSUMED/DISPOSED is manual.
     *  - aggregate (feed etc.): no StockUnit to flip.
     *  Both paths post a StockLedger OUT entry, symmetric with purchase.service.ts's
     *  unconditional StockLedger IN -- otherwise coded draws never leave the ledger,
     *  which breaks low-stock checks for medicine/vaccine/equipment.
     *  Both paths use base_quantity (data.quantity converted to Item.unit via
     *  toBaseQuantity), never the raw entered quantity -- StockLedger is always
     *  in the item's base unit. */
    async create(data: CreateConsumptionInput) {
        try {
            return await prisma.$transaction(async (tx) => {
                await assertHouseActive(tx, data.house_id);
                const base_quantity = await toBaseQuantity(
                    tx,
                    data.item_id,
                    data.unit,
                    data.quantity,
                    "USABLE",
                );

                let nonDepleting = false;
                if (data.stock_unit_id !== undefined) {
                    const unitId = data.stock_unit_id;
                    const unit = await tx.stockUnit.findUnique({
                        where: { id: unitId },
                        include: {
                            purchase_item: {
                                select: {
                                    id: true,
                                    item_id: true,
                                    base_quantity: true,
                                    unit_count: true,
                                    item: { select: { category: true } },
                                },
                            },
                        },
                    });
                    if (!unit) throw AppError.notFound("StockUnit");
                    if (unit.status !== "BOUND" && unit.status !== "IN_USE") {
                        throw AppError.conflict(
                            `StockUnit is ${unit.status.toLowerCase()}, cannot draw from it`,
                        );
                    }
                    await assertUnitInHouse(tx, unitId, data.house_id);
                    // The ledger draw above is for data.item_id; a unit of some other item would
                    // flip that unit to IN_USE while the stock moved for a different item.
                    if (!unit.purchase_item)
                        throw AppError.badRequest("That code isn't linked to a purchase lot yet");
                    if (unit.purchase_item.item_id !== data.item_id) {
                        throw AppError.badRequest("That stock unit belongs to a different item");
                    }

                    // A draw can't take more than is left in the unit (lot size / unit_count, minus earlier
                    // draws) or in its lot as a whole -- the lot check also covers a lot with no unit_count
                    // yet. Equipment is used, not used up, so it has nothing to run out of.
                    nonDepleting = isNonDepleting(unit.purchase_item.item.category);
                    if (!nonDepleting) {
                        await lockLot(tx, unit.purchase_item.id);
                        const left = await codedRemaining(tx, unitId, unit.purchase_item);
                        if (left.unit !== null && left.unit.lessThan(base_quantity)) {
                            throw AppError.conflict(
                                `Only ${left.unit.toString()} is left in this unit`,
                            );
                        }
                        if (left.lot.lessThan(base_quantity)) {
                            throw AppError.conflict(
                                `Only ${left.lot.toString()} is left in this lot`,
                            );
                        }
                    }
                    // A first draw flips BOUND -> IN_USE; CONSUMED/DISPOSED stay manual.
                    if (unit.status === "BOUND") {
                        await tx.stockUnit.update({
                            where: { id: unitId },
                            data: { status: "IN_USE" },
                        });
                    }
                } else {
                    // Aggregate (non-coded) draw -- must not exceed what's actually been
                    // transferred to this house and not yet used.
                    const available = await getItemLocationBalance(
                        tx,
                        data.item_id,
                        "HOUSE",
                        data.house_id,
                    );
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

                // Equipment stays in stock after use; it leaves only when disposed.
                if (!nonDepleting)
                    await StockLedgerService.record(tx, {
                        item_id: data.item_id,
                        quantity: base_quantity,
                        direction: "OUT",
                        reason: "CONSUMPTION",
                        ref_type: "CONSUMPTION",
                        ref_id: consumption.id,
                        // Coded draws too: relocate() moves a unit's stock into its house, and the unit was
                        // checked above to be in this house.
                        location_type: "HOUSE" as const,
                        location_id: data.house_id,
                    });

                return consumption;
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },
};
