import prisma from "@lib/db";
import { Prisma } from "../../prisma/generated/prisma/client";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import { assertHouseActive } from "@lib/active-guards";
import {
    assertUnitInHouse,
    isNonDepleting,
    lockLot,
    unitAmount,
    unitLocation,
} from "@lib/coded-stock";
import { StockLedgerService } from "@services/stock-ledger.service";
import type {
    BindStockUnitInput,
    ListStockUnitsQuery,
    SetStockUnitStatusInput,
    UseStockUnitInput,
} from "@validators/stock-unit.validator";

// Latest allocation = current location. Included on reads so callers still get "where is it".
const withRelations = {
    purchase_item: { include: { item: true } },
    houseAllocations: {
        orderBy: { occurred_at: "desc" as const },
        take: 1,
        include: { house: true },
    },
    asset: true,
};

export const StockUnitService = {
    async getAll(query: ListStockUnitsQuery) {
        const where = {
            ...(query.status !== undefined && { status: query.status }),
            // ponytail: matches "ever allocated to this house", not "currently there". Add
            // latest-allocation filtering only if the UI needs strict current-location filtering.
            ...(query.house_id !== undefined && {
                houseAllocations: { some: { house_id: query.house_id } },
            }),
            ...(query.category !== undefined && {
                purchase_item: { item: { category: query.category } },
            }),
            // Search by unit id (the QR payload) -- full scanned id or a fragment.
            ...(query.q !== undefined && {
                id: { contains: query.q, mode: "insensitive" as const },
            }),
        };
        const [stockUnits, total] = await Promise.all([
            prisma.stockUnit.findMany({
                where,
                include: withRelations,
                orderBy: { created_at: "desc" },
                ...toSkipTake(query),
            }),
            prisma.stockUnit.count({ where }),
        ]);
        return { stockUnits, meta: buildMeta(total, query) };
    },

    /** Per-status totals for the KPI cards -- one aggregate query so counts stay accurate no
     *  matter how many units exist (the list endpoint's page cap would otherwise undercount). */
    async counts() {
        const rows = await prisma.stockUnit.groupBy({ by: ["status"], _count: true });
        return Object.fromEntries(rows.map((r) => [r.status, r._count]));
    },

    async getById(id: string) {
        const unit = await prisma.stockUnit.findUnique({ where: { id }, include: withRelations });
        if (!unit) throw AppError.notFound("StockUnit");
        return unit;
    },

    /** Creates N blank units (status UNASSIGNED, unbound) ahead of need. The row id IS the QR payload. */
    async provision(count: number) {
        return prisma.stockUnit.createManyAndReturn({
            data: Array.from({ length: count }, () => ({})),
        });
    },

    /** UNASSIGNED -> PRINTED once the web print sheet's "did it print?" is confirmed. Reprinting
     *  an already-PRINTED/bound code is a no-op here, so callers can send any printed selection. */
    async markPrinted(ids: string[]) {
        const { count } = await prisma.stockUnit.updateMany({
            where: { id: { in: ids }, status: "UNASSIGNED" },
            data: { status: "PRINTED" },
        });
        return { updated: count };
    },

    /** Binds a printed unit to a purchase lot -- PRINTED -> BOUND. Refused for a lot whose
     *  item isn't flagged is_unit_tracked, so a bulk item (feed, husk) can't end up QR-coded
     *  alongside its own aggregate StockLedger tracking. */
    async bind(id: string, input: BindStockUnitInput) {
        const unit = await prisma.stockUnit.findUnique({ where: { id } });
        if (!unit) throw AppError.notFound("StockUnit");
        if (unit.status === "UNASSIGNED") {
            throw AppError.conflict("Print this code and confirm it printed before binding it");
        }
        if (unit.status !== "PRINTED") {
            throw AppError.conflict(`StockUnit is already ${unit.status.toLowerCase()}`);
        }

        const purchaseItem = await prisma.purchaseItem.findUnique({
            where: { id: input.purchase_item_id },
            include: { item: true },
        });
        if (!purchaseItem)
            throw AppError.badRequest("purchase_item_id does not reference an existing record");
        if (!purchaseItem.item.is_unit_tracked) {
            throw AppError.badRequest(
                `"${purchaseItem.item.name}" isn't tracked by QR code -- use Move Stock instead`,
            );
        }

        try {
            return await prisma.$transaction(async (tx) => {
                // Two phones binding the last slot together would both see room. One lock per lot.
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.purchase_item_id}, 0))`;

                let cap = purchaseItem.unit_count;
                if (cap !== null && input.unit_count !== undefined && input.unit_count !== cap) {
                    throw AppError.conflict(`This lot is already split into ${cap} units`);
                }
                if (cap === null && input.unit_count !== undefined) {
                    cap = input.unit_count;
                    await tx.purchaseItem.update({
                        where: { id: input.purchase_item_id },
                        data: { unit_count: cap },
                    });
                }
                if (cap !== null) {
                    const linked = await tx.stockUnit.count({
                        where: { purchase_item_id: input.purchase_item_id },
                    });
                    if (linked >= cap) {
                        throw AppError.conflict(
                            `This lot is full — ${linked} of ${cap} units already linked`,
                        );
                    }
                }

                return tx.stockUnit.update({
                    where: { id },
                    data: {
                        purchase_item_id: input.purchase_item_id,
                        status: "BOUND",
                        bound_at: new Date(),
                        ...(input.bound_by_id !== undefined && { bound_by_id: input.bound_by_id }),
                    },
                });
            });
        } catch (err) {
            if (err instanceof AppError) throw err;
            return handlePrismaWriteError(err);
        }
    },

    /** Records a physical move as a StockHouseAllocation event -- warehouse->house (ALLOCATION),
     *  house->house (REALLOCATION), or house->warehouse (RETURN, house_id null). Type is derived
     *  from the unit's latest event so it can never be recorded out of step with reality.
     *
     *  `stock_transfer_id` is an optional caller-supplied link to the aggregate-quantity
     *  StockTransfer (and its 2 StockLedger rows) this move was part of -- e.g. 10 units scanned
     *  into one "allocate 10L to House Y" batch all pass the same transfer id, so the ledger
     *  stays one movement instead of fragmenting into one pair per unit. relocate() trusts the
     *  id rather than deriving it (that lives in the batch orchestration, not here), and only
     *  checks it actually exists and is for the same item -- not that its quantity/locations
     *  match this exact move. */
    async relocate(
        id: string,
        house_id: string | null,
        idempotency_key: string,
        stock_transfer_id?: string,
        /** Who moved it -- recorded on the transfer this posts. Falls back to whoever recorded the lot. */
        recorded_by_id?: string,
    ) {
        const unit = await prisma.stockUnit.findUnique({
            where: { id },
            include: {
                purchase_item: {
                    include: {
                        item: { select: { unit: true, category: true } },
                        purchase: { select: { recorded_by_id: true, warehouse_id: true } },
                    },
                },
            },
        });
        if (!unit) throw AppError.notFound("StockUnit");
        // A blank code is just a sticker until it's bound to a lot; a used-up or disposed unit isn't
        // anywhere any more. Moving either would give it a location it can't have.
        if (unit.status === "UNASSIGNED" || unit.status === "PRINTED" || !unit.purchase_item) {
            throw AppError.badRequest(
                "This code isn't linked to a purchase lot yet -- bind it first",
            );
        }
        if (unit.status === "DISPOSED" || unit.status === "CONSUMED") {
            throw AppError.conflict(`StockUnit is ${unit.status.toLowerCase()}, it can't be moved`);
        }

        if (stock_transfer_id !== undefined) {
            const transfer = await prisma.stockTransfer.findUnique({
                where: { id: stock_transfer_id },
            });
            if (!transfer) throw AppError.notFound("StockTransfer");
            if (!unit.purchase_item || transfer.item_id !== unit.purchase_item.item_id) {
                throw AppError.badRequest(
                    "stock_transfer_id is for a different item than this unit",
                );
            }
        }

        try {
            return await prisma.$transaction(async (tx) => {
                // The unit's current house is "its latest allocation", so two relocations racing
                // would both read the same latest row. One lock per unit makes the second wait.
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
                // A unit can leave a deactivated house (that's how it's emptied) but not go into one.
                if (house_id !== null) await assertHouseActive(tx, house_id);
                const latest = await tx.stockHouseAllocation.findFirst({
                    where: { stock_unit_id: id },
                    orderBy: { occurred_at: "desc" },
                });
                const currentHouseId = latest?.house_id ?? null;

                if (house_id === currentHouseId) {
                    throw AppError.conflict(
                        house_id === null
                            ? "Unit is already at the warehouse"
                            : "Unit is already at that house",
                    );
                }
                const type: "ALLOCATION" | "REALLOCATION" | "RETURN" =
                    house_id === null
                        ? "RETURN"
                        : currentHouseId === null
                          ? "ALLOCATION"
                          : "REALLOCATION";

                // The ledger follows the unit: move what's in it from where it is to where it's going,
                // so warehouse and house stock both see the move. Skipped when the caller already
                // recorded the movement as a transfer of its own (the web's "link to ledger").
                let transferId = stock_transfer_id;
                const lot = unit.purchase_item!;
                if (transferId === undefined) {
                    await lockLot(tx, lot.id);
                    const amount = await unitAmount(tx, id, lot);
                    if (amount.greaterThan(0)) {
                        const from = await unitLocation(tx, id, lot);
                        // A return goes back to the warehouse its lot was bought into.
                        const to =
                            house_id === null
                                ? {
                                      location_type: "WAREHOUSE" as const,
                                      location_id: lot.purchase.warehouse_id,
                                  }
                                : { location_type: "HOUSE" as const, location_id: house_id };
                        const transfer = await tx.stockTransfer.create({
                            data: {
                                item_id: lot.item_id,
                                from_location_type: from.location_type,
                                from_location_id: from.location_id,
                                to_location_type: to.location_type,
                                to_location_id: to.location_id,
                                quantity: amount,
                                unit: lot.item.unit,
                                base_quantity: amount,
                                note: "Coded unit moved",
                                recorded_by_id: recorded_by_id ?? lot.purchase.recorded_by_id,
                                idempotency_key: `${idempotency_key}:transfer`,
                            },
                        });
                        for (const [direction, at] of [
                            ["OUT", from],
                            ["IN", to],
                        ] as const) {
                            await StockLedgerService.record(tx, {
                                item_id: lot.item_id,
                                quantity: amount,
                                direction,
                                reason: "TRANSFER",
                                ref_type: "TRANSFER",
                                ref_id: transfer.id,
                                location_type: at.location_type,
                                location_id: at.location_id,
                            });
                        }
                        transferId = transfer.id;
                    }
                }

                return tx.stockHouseAllocation.create({
                    data: {
                        stock_unit_id: id,
                        house_id,
                        type,
                        idempotency_key,
                        ...(transferId !== undefined && { stock_transfer_id: transferId }),
                    },
                });
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    /** DISPOSED is final. Whatever was still in the unit leaves stock with it (see writeOffRemainder). */
    async dispose(id: string) {
        return prisma.$transaction(async (tx) => {
            const unit = await lockedUnit(tx, id);
            if (unit.status === "DISPOSED")
                throw AppError.conflict("StockUnit is already disposed");
            // A CONSUMED unit's remainder was already written off when it was marked used up.
            if (unit.status !== "CONSUMED") await writeOffRemainder(tx, unit);
            return tx.stockUnit.update({ where: { id }, data: { status: "DISPOSED" } });
        });
    },

    /** "Use an item" on the floor, one scanned unit at a time, where it physically is.
     *  - START: BOUND -> IN_USE (opened). Nothing leaves stock and no Consumption is logged.
     *  - FINISH: BOUND/IN_USE -> CONSUMED, logging a Consumption of exactly what was left in the unit
     *    (StockLedger OUT from this house), so the batch's P&L pays for it.
     *  Equipment is used, not used up: it can be started, but leaves through dispose(), not FINISH. */
    async use(id: string, input: UseStockUnitInput) {
        try {
            return await prisma.$transaction(async (tx) => {
                await assertHouseActive(tx, input.house_id);
                const unit = await lockedUnit(tx, id);
                const lot = unit.purchase_item;
                if (!lot) throw AppError.badRequest("That code isn't linked to a purchase lot yet");
                const allowed = input.action === "START" ? ["BOUND"] : ["BOUND", "IN_USE"];
                if (!allowed.includes(unit.status)) {
                    throw AppError.conflict(
                        unit.status === "IN_USE"
                            ? "This unit is already in use"
                            : `StockUnit is ${unit.status.toLowerCase().replace("_", " ")}`,
                    );
                }
                await assertUnitInHouse(tx, id, input.house_id);

                if (input.action === "START") {
                    return tx.stockUnit.update({ where: { id }, data: { status: "IN_USE" } });
                }
                if (isNonDepleting(lot.item.category)) {
                    throw AppError.badRequest(
                        "Equipment isn't used up -- dispose it when it's done",
                    );
                }

                await lockLot(tx, lot.id);
                const amount = await unitAmount(tx, id, lot);
                if (amount.greaterThan(0)) {
                    const { unit: baseUnit } = await tx.item.findUniqueOrThrow({
                        where: { id: lot.item_id },
                        select: { unit: true },
                    });
                    const consumption = await tx.consumption.create({
                        data: {
                            house_id: input.house_id,
                            item_id: lot.item_id,
                            stock_unit_id: id,
                            // What was left, in the item's base unit -- so quantity and base_quantity agree.
                            quantity: amount,
                            unit: baseUnit,
                            base_quantity: amount,
                            date: input.date,
                            recorded_by_id: input.recorded_by_id,
                            idempotency_key: input.idempotency_key ?? crypto.randomUUID(),
                            ...(input.batch_id !== undefined && { batch_id: input.batch_id }),
                        },
                    });
                    await StockLedgerService.record(tx, {
                        item_id: lot.item_id,
                        quantity: amount,
                        direction: "OUT",
                        reason: "CONSUMPTION",
                        ref_type: "CONSUMPTION",
                        ref_id: consumption.id,
                        location_type: "HOUSE",
                        location_id: input.house_id,
                    });
                }
                return tx.stockUnit.update({ where: { id }, data: { status: "CONSUMED" } });
            });
        } catch (err) {
            if (err instanceof AppError) throw err;
            return handlePrismaWriteError(err);
        }
    },

    /** The manual "change status" action. DISPOSED is final and goes through dispose(); CONSUMED can
     *  only go on to DISPOSED, since its leftover has already left the ledger; UNASSIGNED only comes
     *  from a blank code, never from a status pick. */
    async setStatus(id: string, status: SetStockUnitStatusInput["status"]) {
        if (status === "DISPOSED") return this.dispose(id);
        return prisma.$transaction(async (tx) => {
            const unit = await lockedUnit(tx, id);
            if (unit.status === "DISPOSED")
                throw AppError.conflict("A disposed unit can't change status");
            if (
                status === "UNASSIGNED" ||
                status === "PRINTED" ||
                unit.status === "UNASSIGNED" ||
                unit.status === "PRINTED"
            ) {
                throw AppError.badRequest(
                    "Print and bind the code instead of setting UNASSIGNED/PRINTED by hand",
                );
            }
            if (unit.status === "CONSUMED" && status !== "CONSUMED") {
                throw AppError.conflict("A used-up unit can only be disposed");
            }
            if (status === "CONSUMED" && unit.status !== "CONSUMED")
                await writeOffRemainder(tx, unit);
            return tx.stockUnit.update({ where: { id }, data: { status } });
        });
    },

    /** Hard delete -- for mistakenly-provisioned/bound codes. Its house-allocation event log is
     *  purged with it (safe: just move history). A unit that's been consumed from or turned into an
     *  asset is real data, not a mistake, so those are refused rather than silently orphaned. */
    async remove(id: string) {
        const unit = await prisma.stockUnit.findUnique({
            where: { id },
            include: { _count: { select: { consumptions: true } }, asset: true },
        });
        if (!unit) throw AppError.notFound("StockUnit");
        if (unit._count.consumptions > 0 || unit.asset) {
            throw AppError.conflict(
                "Cannot delete a unit with consumption history or a linked asset",
            );
        }
        await prisma.$transaction([
            prisma.stockHouseAllocation.deleteMany({ where: { stock_unit_id: id } }),
            prisma.stockUnit.delete({ where: { id } }),
        ]);
    },
};

async function lockedUnit(tx: Prisma.TransactionClient, id: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
    const unit = await tx.stockUnit.findUnique({
        where: { id },
        include: { purchase_item: { include: { item: { select: { category: true } } } } },
    });
    if (!unit) throw AppError.notFound("StockUnit");
    return unit;
}

/** A unit leaving play (used up or disposed) takes what was still in it out of stock: a WASTAGE OUT of
 *  the remainder (ref_id = the unit) from wherever the unit is, so that location's balance, stock value
 *  and the wastage report all see it. Equipment is written off whole (1 of its base unit). */
async function writeOffRemainder(
    tx: Prisma.TransactionClient,
    unit: Awaited<ReturnType<typeof lockedUnit>>,
) {
    const lot = unit.purchase_item;
    if (!lot) return;
    await lockLot(tx, lot.id);
    const writeOff = await unitAmount(tx, unit.id, lot);
    if (!writeOff.greaterThan(0)) return;
    await StockLedgerService.record(tx, {
        item_id: lot.item_id,
        quantity: writeOff,
        direction: "OUT",
        reason: "WASTAGE",
        ref_type: "ADJUSTMENT",
        ref_id: unit.id,
        ...(await unitLocation(tx, unit.id, lot)),
    });
}
