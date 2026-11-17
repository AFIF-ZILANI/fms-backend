import prisma from "@lib/db";
import { Prisma } from "../../prisma/generated/prisma/client";
import { assertBatchOpen, batchForUsage, batchInHouseOn } from "@lib/batch-guards";
import { audit } from "@lib/audit";
import { assertHouseActive } from "@lib/active-guards";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import { toBaseQuantity } from "@lib/unit-conversion";
import { getItemLocationBalance } from "@lib/stock-balance";
import { StockLedgerService } from "@services/stock-ledger.service";
import {
    assertUnitInHouse,
    codedRemaining,
    isNonDepleting,
    lockLot,
    unitAmount,
} from "@lib/coded-stock";
import type {
    CreateConsumptionInput,
    FixConsumptionInput,
    ListConsumptionsQuery,
    RemoveConsumptionInput,
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
                    // With its unit conversions, so clients can read feed in bags ("3 Bag 20 kg").
                    item: { include: { itemUnits: true } },
                    stock_unit: true,
                    recorded_by: { select: { id: true, name: true } },
                    fixed_by: { select: { id: true, name: true } },
                },
                orderBy: { date: "desc" },
                ...toSkipTake(query),
            }),
            prisma.consumption.count({ where }),
        ]);
        return { consumptions, meta: buildMeta(total, query) };
    },

    /** One record, for the Fix usage form: the item with its units, the bottle, and whether its batch is closed. */
    async getById(id: string) {
        const c = await prisma.consumption.findUnique({
            where: { id },
            include: {
                batch: { select: { id: true, batch_code: true, status: true } },
                house: { select: { id: true, name: true } },
                item: { include: { itemUnits: true } },
                stock_unit: { include: { purchase_item: { select: { id: true, item_id: true } } } },
                recorded_by: { select: { id: true, name: true } },
                fixed_by: { select: { id: true, name: true } },
                medications: { select: { id: true, medicine_name: true } },
                vaccinations: { select: { id: true, vaccine_name: true, schedule_id: true } },
            },
        });
        if (!c) throw AppError.notFound("Consumption");
        return c;
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

    async create(data: CreateConsumptionInput) {
        try {
            return await prisma.$transaction((tx) => drawConsumption(tx, data));
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    async fix(id: string, input: FixConsumptionInput) {
        return prisma.$transaction((tx) => fixConsumption(tx, id, input));
    },

    async remove(id: string, input: RemoveConsumptionInput) {
        return prisma.$transaction((tx) => removeConsumption(tx, id, input));
    },
};

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
 *  in the item's base unit.
 *  Runs inside the caller's transaction -- the vaccine confirm draws several bottles in one. */
export async function drawConsumption(tx: Prisma.TransactionClient, data: CreateConsumptionInput) {
    await assertHouseActive(tx, data.house_id);
    const batch_id = await batchForUsage(tx, data.house_id, data.date, data.batch_id);
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
                throw AppError.conflict(`Only ${left.unit.toString()} is left in this unit`);
            }
            if (left.lot.lessThan(base_quantity)) {
                throw AppError.conflict(`Only ${left.lot.toString()} is left in this lot`);
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
            ...(batch_id !== undefined && { batch_id }),
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
}

// ════════════════════════════════════════════════════════════════════
// FIX USAGE (docs/usage-fix-design.md): a wrong record is corrected in place or removed, never
// patched with a second record, so the batch's feed, cost and FCR read one right row.
// ════════════════════════════════════════════════════════════════════

const fixInclude = {
    item: { select: { id: true, name: true, unit: true, category: true } },
    stock_unit: {
        include: {
            purchase_item: {
                select: {
                    id: true,
                    item_id: true,
                    base_quantity: true,
                    unit_count: true,
                    item: { select: { id: true, name: true, unit: true, category: true } },
                },
            },
        },
    },
    medications: true,
    vaccinations: true,
} satisfies Prisma.ConsumptionInclude;

async function lockedConsumption(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`SELECT id FROM "Consumption" WHERE id = ${id} FOR UPDATE`;
    const c = await tx.consumption.findUnique({ where: { id }, include: fixInclude });
    if (!c) throw AppError.notFound("Consumption");
    if (c.batch_id) await assertBatchOpen(tx, c.batch_id);
    return c;
}
type Locked = Awaited<ReturnType<typeof lockedConsumption>>;

/** Can this record's bottle take its dose back? Returns true when the record is the draw that used the
 *  bottle up (FINISH, vaccine schedule confirm): its amount was "whatever was left", so it can't be typed. */
async function oldBottleState(
    tx: Prisma.TransactionClient,
    c: Locked,
): Promise<{ usedUp: boolean }> {
    const unit = c.stock_unit;
    if (!unit) return { usedUp: false };
    if (unit.status === "SOLD" || unit.status === "DISPOSED")
        throw AppError.conflict(
            `That bottle is ${unit.status.toLowerCase()} -- its use can't be changed`,
        );
    if (unit.status !== "CONSUMED") return { usedUp: false };
    // Marked used up by hand: its leftover was already written off (WASTAGE), so it can't take a dose back.
    const writtenOff = await tx.stockLedger.count({
        where: { reason: "WASTAGE", ref_type: "ADJUSTMENT", ref_id: unit.id },
    });
    if (writtenOff > 0)
        throw AppError.conflict(
            "That bottle was marked used up by hand -- its use can't be changed",
        );
    const last = await tx.consumption.findFirst({
        where: { stock_unit_id: unit.id },
        orderBy: [{ created_at: "desc" }, { id: "desc" }],
        select: { id: true },
    });
    if (last?.id !== c.id)
        throw AppError.conflict(
            "That bottle was used up by a later record -- fix that one instead",
        );
    return { usedUp: true };
}

/** After a bottle loses a use: used up -> back in play; opened with nothing drawn -> back on the shelf. */
async function settleOldBottle(tx: Prisma.TransactionClient, unit: { id: string; status: string }) {
    const uses = await tx.consumption.count({ where: { stock_unit_id: unit.id } });
    const status =
        unit.status === "CONSUMED"
            ? uses > 0
                ? "IN_USE"
                : "BOUND"
            : unit.status === "IN_USE" && uses === 0
              ? "BOUND"
              : null;
    if (status) await tx.stockUnit.update({ where: { id: unit.id }, data: { status } });
}

const snapshot = (c: Locked) => JSON.parse(JSON.stringify(c)) as Prisma.InputJsonValue;

export async function fixConsumption(
    tx: Prisma.TransactionClient,
    id: string,
    input: FixConsumptionInput,
) {
    const c = await lockedConsumption(tx, id);
    const coded = c.stock_unit !== null;
    const nonDepleting = isNonDepleting(c.item.category);
    const scheduled = c.vaccinations.some((v) => v.schedule_id !== null);

    if (!coded && input.stock_unit_id !== undefined)
        throw AppError.badRequest("This item has no codes -- there's no bottle to change");
    const swap =
        coded && input.stock_unit_id !== undefined && input.stock_unit_id !== c.stock_unit_id;
    const amountChange = input.quantity !== undefined || input.unit !== undefined;
    const { usedUp } =
        coded && (swap || amountChange) ? await oldBottleState(tx, c) : { usedUp: false };
    if (usedUp && amountChange)
        throw AppError.badRequest(
            "This bottle was used up, so its amount is what was left -- change the bottle or remove it",
        );
    if (nonDepleting && amountChange) throw AppError.badRequest("Equipment has no amount to fix");

    // ── date and batch ──
    const date = input.date ?? c.date;
    if (date.getTime() > Date.now()) throw AppError.badRequest("The date can't be in the future");
    let batch_id = c.batch_id;
    if (input.date !== undefined && input.date.getTime() !== c.date.getTime()) {
        batch_id = (await batchInHouseOn(tx, c.house_id, date))?.id ?? null;
        if (batch_id !== c.batch_id) {
            if (batch_id) await assertBatchOpen(tx, batch_id);
            if (scheduled)
                throw AppError.conflict(
                    "This use confirmed a vaccine schedule step -- it can't move to another batch",
                );
            if (!batch_id && (c.medications.length > 0 || c.vaccinations.length > 0))
                throw AppError.conflict(
                    "No batch was in this house on that day, and this use is linked to a treatment",
                );
        }
    }

    // ── the bottle ──
    let unit = c.stock_unit;
    if (swap) {
        unit = await tx.stockUnit.findUnique({
            where: { id: input.stock_unit_id! },
            include: fixInclude.stock_unit.include,
        });
        if (!unit) throw AppError.notFound("StockUnit");
        if (unit.status !== "BOUND" && unit.status !== "IN_USE")
            throw AppError.conflict(
                `That bottle is ${unit.status.toLowerCase().replace("_", " ")}, it can't be used`,
            );
        if (!unit.purchase_item)
            throw AppError.badRequest("That code isn't linked to a purchase lot yet");
        await assertUnitInHouse(tx, unit.id, c.house_id);
        if (scheduled && unit.purchase_item.item.category !== "VACCINE")
            throw AppError.badRequest(`${unit.purchase_item.item.name} isn't a vaccine`);
        if (isNonDepleting(unit.purchase_item.item.category) !== nonDepleting)
            throw AppError.badRequest("Equipment can only be swapped for equipment");
    }
    const item = unit?.purchase_item?.item ?? c.item;

    // ── amount ──
    let quantity = new Prisma.Decimal(input.quantity ?? c.quantity);
    let unitCode = input.unit ?? (item.id !== c.item.id ? item.unit : c.unit);
    let base_quantity = c.base_quantity;
    const lots = [c.stock_unit?.purchase_item?.id, unit?.purchase_item?.id].filter(
        (l): l is string => !!l,
    );
    for (const lot of [...new Set(lots)].sort()) await lockLot(tx, lot);

    if (usedUp && swap) {
        // The new bottle is used up the same way: what's left in it is what was given.
        base_quantity = await unitAmount(tx, unit!.id, unit!.purchase_item!);
        if (!base_quantity.greaterThan(0)) throw AppError.conflict("That bottle is already empty");
        quantity = base_quantity;
        unitCode = item.unit;
    } else if (!nonDepleting && (amountChange || swap)) {
        base_quantity = await toBaseQuantity(tx, item.id, unitCode, quantity.toNumber(), "USABLE");
    }

    if (!nonDepleting) {
        if (!coded) {
            // The house only has to cover the increase; this record's draw is already off its balance.
            const more = base_quantity.minus(c.base_quantity);
            if (more.greaterThan(0)) {
                const available = await getItemLocationBalance(tx, item.id, "HOUSE", c.house_id);
                if (available.lessThan(more))
                    throw AppError.conflict(
                        `Only ${available.toString()} more of this item is on hand at this house`,
                    );
            }
        } else if (!(usedUp && swap) && (amountChange || swap)) {
            const lot = unit!.purchase_item!;
            const left = await codedRemaining(tx, unit!.id, lot);
            // Left in the same bottle / lot already has this record's draw taken off; give it back first.
            const unitLeft = left.unit?.plus(swap ? 0 : c.base_quantity) ?? null;
            const lotLeft = left.lot.plus(
                lot.id === c.stock_unit!.purchase_item?.id ? c.base_quantity : 0,
            );
            if (unitLeft !== null && unitLeft.lessThan(base_quantity))
                throw AppError.conflict(`Only ${unitLeft.toString()} is left in this bottle`);
            if (lotLeft.lessThan(base_quantity))
                throw AppError.conflict(`Only ${lotLeft.toString()} is left in this lot`);
        }
    }

    // ── writes ──
    const updated = await tx.consumption.update({
        where: { id },
        data: {
            item_id: item.id,
            stock_unit_id: unit?.id ?? null,
            quantity,
            unit: unitCode,
            base_quantity,
            date,
            batch_id,
            fixed_at: new Date(),
            fixed_by_id: input.actor_id,
            fix_reason: input.reason,
        },
        include: fixInclude,
    });
    if (!nonDepleting)
        await tx.stockLedger.updateMany({
            where: { ref_type: "CONSUMPTION", ref_id: id, direction: "OUT" },
            data: { item_id: item.id, quantity: base_quantity },
        });
    if (swap) {
        const next = usedUp ? "CONSUMED" : unit!.status === "BOUND" ? "IN_USE" : null;
        if (next) await tx.stockUnit.update({ where: { id: unit!.id }, data: { status: next } });
        await settleOldBottle(tx, c.stock_unit!);
    }
    // A bottle swap alone leaves the treatment's own date as it was.
    const dateChanged = date.getTime() !== c.date.getTime();
    if (batch_id && (batch_id !== c.batch_id || dateChanged || item.id !== c.item.id)) {
        await tx.medications.updateMany({
            where: { consumption_id: id },
            data: {
                batch_id,
                ...(dateChanged && { date }),
                ...(item.id !== c.item.id && { medicine_name: item.name }),
            },
        });
        await tx.vaccinations.updateMany({
            where: { consumption_id: id },
            data: {
                batch_id,
                ...(dateChanged && { date }),
                ...(item.id !== c.item.id && { vaccine_name: item.name }),
            },
        });
    }
    // A schedule confirm's dose is the bottle's amount; a typed vaccination keeps the dose it was given.
    if (scheduled)
        await tx.vaccinations.updateMany({
            where: { consumption_id: id, schedule_id: { not: null } },
            data: { dosage: quantity },
        });

    await audit(tx, {
        table: "Consumption",
        record_id: id,
        action: "UPDATE",
        actor_id: input.actor_id,
        note: `Fixed usage: ${input.reason}`,
        before: snapshot(c),
        after: snapshot(
            await tx.consumption.findUniqueOrThrow({ where: { id }, include: fixInclude }),
        ),
    });
    return updated;
}

export async function removeConsumption(
    tx: Prisma.TransactionClient,
    id: string,
    input: RemoveConsumptionInput,
) {
    const c = await lockedConsumption(tx, id);
    if (c.stock_unit) await oldBottleState(tx, c);
    if (c.stock_unit?.purchase_item) await lockLot(tx, c.stock_unit.purchase_item.id);

    // A wrong use makes everything that hangs off it wrong too: its treatment, its vaccination, and the
    // vaccine schedule step it confirmed for this house (with the houses on its water line).
    const undone: { schedule_id: string; confirms: number; reopened: boolean }[] = [];
    await tx.medications.deleteMany({ where: { consumption_id: id } });
    await tx.vaccinations.deleteMany({ where: { consumption_id: id } });
    for (const schedule_id of new Set(
        c.vaccinations.map((v) => v.schedule_id).filter((s): s is string => !!s),
    )) {
        const others = await tx.vaccinations.count({
            where: { schedule_id, consumption: { house_id: c.house_id } },
        });
        if (others > 0) continue;
        const { count } = await tx.batchVaccineHouseConfirm.deleteMany({
            where: { schedule_id, OR: [{ house_id: c.house_id }, { via_house_id: c.house_id }] },
        });
        const { count: reopened } = await tx.batchVaccineSchedule.updateMany({
            where: { id: schedule_id, status: "DONE" },
            data: { status: "PENDING", confirmed_by_id: null, confirmed_at: null },
        });
        undone.push({ schedule_id, confirms: count, reopened: reopened > 0 });
    }
    const ledger = await tx.stockLedger.findMany({
        where: { ref_type: "CONSUMPTION", ref_id: id },
    });
    await tx.stockLedger.deleteMany({ where: { ref_type: "CONSUMPTION", ref_id: id } });
    await tx.consumption.delete({ where: { id } });
    if (c.stock_unit) await settleOldBottle(tx, c.stock_unit);

    await audit(tx, {
        table: "Consumption",
        record_id: id,
        action: "DELETE",
        actor_id: input.actor_id,
        note: `Removed usage: ${input.reason}`,
        before: JSON.parse(
            JSON.stringify({ ...c, ledger, schedule_undone: undone }),
        ) as Prisma.InputJsonValue,
    });
}
