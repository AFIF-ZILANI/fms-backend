import prisma from "@lib/db";
import { Prisma } from "../../prisma/generated/prisma/client";
import { AppError } from "@lib/app-error";
import { getItemAvgCosts } from "@lib/stock-value";
import { isNonDepleting, unitAmount } from "@lib/coded-stock";
import { kgPerBaseUnit } from "@lib/unit-conversion";
import { cycleDay } from "@lib/farm-day";

/**
 * What stock a batch has gone through, per item and per house:
 *
 *   used       its Consumption rows
 *   in use     opened coded units (IN_USE) whose latest draw was this batch's -- what's still in them.
 *              Latest draw, so a half-used bottle the next batch picks up moves to that batch.
 *   allocated  stock moved INTO a house while this batch was in it (its stay window)
 *   cost       (used + in use) at average landed cost, like the P&L. Equipment costs nothing here
 *              (it reaches a batch through depreciation); an item never bought has no known cost.
 *
 * ponytail: allocated assumes one batch per house at a time; two batches sharing a house during a window
 * both see the same transfers. Split by bird count if that ever happens on this farm.
 */

export type Stay = { house_id: string; from: Date; to: Date };

/** When the batch was in each house: from its first move in, to when its balance there hit zero (the
 *  balance row's updated_at -- how HouseService dates a vacated house), or the batch's end if still there. */
export function stayWindows(
    moves: { to_house_id: string | null; occurred_at: Date }[],
    balances: { house_id: string; quantity: number; updated_at: Date }[],
    batchEnd: Date,
): Stay[] {
    const first = new Map<string, Date>();
    for (const m of moves) {
        if (!m.to_house_id) continue;
        const seen = first.get(m.to_house_id);
        if (!seen || m.occurred_at < seen) first.set(m.to_house_id, m.occurred_at);
    }
    return [...first].map(([house_id, from]) => {
        const bal = balances.find((b) => b.house_id === house_id);
        const left = bal && bal.quantity === 0 ? bal.updated_at : batchEnd;
        const to = left > batchEnd ? batchEnd : left;
        return { house_id, from, to: to < from ? from : to };
    });
}

const D = (v: Prisma.Decimal | number | string | null | undefined) => new Prisma.Decimal(v ?? 0);
const q = (d: Prisma.Decimal) => Number(d.toFixed(3));
const money = (d: Prisma.Decimal) => Number(d.toFixed(2));
// Supplements are given the way medicine is (in water, by course), so the farm reads them together.
type Bucket = "FEED" | "MEDICINE" | "VACCINE" | "OTHER";
const bucketOf = (cat: string): Bucket =>
    cat === "SUPPLEMENT" ? "MEDICINE" : cat === "FEED" || cat === "MEDICINE" || cat === "VACCINE" ? cat : "OTHER";

type Tally = { used: Prisma.Decimal; in_use: Prisma.Decimal; in_use_units: number; allocated: Prisma.Decimal };
const tally = (): Tally => ({ used: D(0), in_use: D(0), in_use_units: 0, allocated: D(0) });

export const BatchStockService = {
    async summary(batchId: string) {
        const batch = await prisma.batches.findUnique({
            where: { id: batchId },
            include: { houseBalances: true },
        });
        if (!batch) throw AppError.notFound("Batch");
        const batchEnd = batch.actual_end_date ?? new Date();

        const [moves, consumed, openUnits, deaths, sales, chickLines] = await Promise.all([
            prisma.batchHouseAllocation.findMany({
                where: { batch_id: batchId },
                select: { to_house_id: true, occurred_at: true },
            }),
            prisma.consumption.findMany({
                where: { batch_id: batchId },
                select: { item_id: true, house_id: true, base_quantity: true, date: true },
            }),
            prisma.stockUnit.findMany({
                where: { status: "IN_USE", consumptions: { some: { batch_id: batchId } } },
                select: {
                    id: true,
                    purchase_item: {
                        select: {
                            id: true,
                            item_id: true,
                            base_quantity: true,
                            unit_count: true,
                            item: { select: { category: true } },
                        },
                    },
                    consumptions: {
                        orderBy: [{ date: "desc" }, { created_at: "desc" }],
                        take: 1,
                        select: { batch_id: true, house_id: true },
                    },
                },
            }),
            prisma.mortalityLog.findMany({ where: { batch_id: batchId }, select: { date: true, count_died: true } }),
            prisma.birdSale.findMany({ where: { batch_id: batchId }, select: { sale_date: true, birds_count: true } }),
            prisma.purchaseItem.findMany({ where: { batch_id: batchId }, select: { item_id: true } }),
        ]);

        // Houses it drew stock in without a recorded move in still count, for the whole batch.
        const stays = stayWindows(moves, batch.houseBalances, batchEnd);
        for (const c of consumed)
            if (!stays.some((s) => s.house_id === c.house_id))
                stays.push({ house_id: c.house_id, from: batch.starting_date, to: batchEnd });

        // in use: only units this batch drew last
        const mine = openUnits.filter((u) => u.purchase_item && u.consumptions[0]?.batch_id === batchId);
        const inUse = await prisma.$transaction((tx) =>
            Promise.all(
                mine.map(async (u) => ({
                    item_id: u.purchase_item!.item_id,
                    house_id: u.consumptions[0]!.house_id,
                    amount: await unitAmount(tx, u.id, u.purchase_item!),
                })),
            ),
        );

        // allocated: transfers into each house inside its stay window
        const transfersIn = stays.length
            ? await prisma.stockLedger.findMany({
                  where: {
                      reason: "TRANSFER",
                      direction: "IN",
                      location_type: "HOUSE",
                      OR: stays.map((s) => ({
                          location_id: s.house_id,
                          occurred_at: { gte: s.from, lte: s.to },
                      })),
                  },
                  select: { item_id: true, location_id: true, quantity: true },
              })
            : [];

        // ── per item, per house ──
        const byItem = new Map<string, { total: Tally; houses: Map<string, Tally> }>();
        const at = (item_id: string, house_id: string) => {
            const it = byItem.get(item_id) ?? { total: tally(), houses: new Map<string, Tally>() };
            byItem.set(item_id, it);
            const h = it.houses.get(house_id) ?? tally();
            it.houses.set(house_id, h);
            return [it.total, h] as const;
        };
        for (const c of consumed) for (const t of at(c.item_id, c.house_id)) t.used = t.used.plus(c.base_quantity);
        for (const u of inUse)
            for (const t of at(u.item_id, u.house_id)) {
                t.in_use = t.in_use.plus(u.amount);
                t.in_use_units += 1;
            }
        for (const r of transfersIn)
            for (const t of at(r.item_id, r.location_id!)) t.allocated = t.allocated.plus(r.quantity);

        const itemIds = [...byItem.keys()];
        const houseIds = [...new Set(stays.map((s) => s.house_id))];
        const [items, houses, avg] = await Promise.all([
            prisma.item.findMany({
                where: { id: { in: itemIds } },
                select: {
                    id: true,
                    name: true,
                    category: true,
                    unit: true,
                    itemUnits: { select: { unit: true, factor_to_base: true } },
                },
            }),
            prisma.houses.findMany({ where: { id: { in: houseIds } }, select: { id: true, name: true } }),
            getItemAvgCosts(itemIds),
        ]);
        const itemById = new Map(items.map((i) => [i.id, i]));
        const houseName = new Map(houses.map((h) => [h.id, h.name]));
        // Chicks bought on the batch are costed as chicks in the P&L, not as stock.
        const boughtOnBatch = new Set(chickLines.map((l) => l.item_id));
        const unitCost = (item_id: string) => {
            const item = itemById.get(item_id);
            if (!item || isNonDepleting(item.category) || boughtOnBatch.has(item_id)) return D(0);
            return avg.get(item_id) ?? null;
        };
        const costOf = (t: Tally, cost: Prisma.Decimal | null) =>
            cost === null ? null : t.used.plus(t.in_use).times(cost);

        let total = D(0);
        const byBucket: Record<Bucket, Prisma.Decimal> = { FEED: D(0), MEDICINE: D(0), VACCINE: D(0), OTHER: D(0) };
        const rows = itemIds.map((item_id) => {
            const item = itemById.get(item_id)!;
            const { total: t, houses: hs } = byItem.get(item_id)!;
            const cost = unitCost(item_id);
            const value = costOf(t, cost);
            if (value) {
                total = total.plus(value);
                byBucket[bucketOf(item.category)] = byBucket[bucketOf(item.category)].plus(value);
            }
            return {
                item_id,
                item_name: item.name,
                category: item.category,
                unit: item.unit,
                non_depleting: isNonDepleting(item.category),
                used: q(t.used),
                in_use: q(t.in_use),
                in_use_units: t.in_use_units,
                allocated: q(t.allocated),
                unit_cost: cost === null ? null : Number(cost.toFixed(4)),
                cost: value === null ? null : money(value),
                houses: [...hs].map(([house_id, h]) => {
                    const v = costOf(h, cost);
                    return {
                        house_id,
                        house_name: houseName.get(house_id) ?? "Unknown house",
                        used: q(h.used),
                        in_use: q(h.in_use),
                        in_use_units: h.in_use_units,
                        allocated: q(h.allocated),
                        cost: v === null ? null : money(v),
                    };
                }),
            };
        });
        rows.sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1) || a.item_name.localeCompare(b.item_name));

        // ── by cycle day: cost of what was used, feed kg, and birds alive that morning ──
        const days = cycleDay(batch.starting_date, batchEnd);
        const daily = Array.from({ length: days }, (_, i) => ({
            day: i + 1,
            feed_cost: 0,
            medicine_cost: 0,
            vaccine_cost: 0,
            other_cost: 0,
            feed_kg: 0,
            birds: 0,
        }));
        const dayOf = (d: Date) => Math.min(cycleDay(batch.starting_date, d), days) - 1;
        for (const c of consumed) {
            const item = itemById.get(c.item_id)!;
            const row = daily[dayOf(c.date)]!;
            const cost = unitCost(c.item_id);
            if (cost) {
                const v = c.base_quantity.times(cost).toNumber();
                const b = bucketOf(item.category);
                if (b === "FEED") row.feed_cost += v;
                else if (b === "MEDICINE") row.medicine_cost += v;
                else if (b === "VACCINE") row.vaccine_cost += v;
                else row.other_cost += v;
            }
            if (item.category === "FEED") {
                const perKg = kgPerBaseUnit(item.unit, item.itemUnits);
                if (perKg !== null) row.feed_kg += c.base_quantity.toNumber() * perKg;
            }
        }
        const lost = new Array<number>(days).fill(0);
        for (const m of deaths) lost[dayOf(m.date)]! += m.count_died;
        for (const s of sales) lost[dayOf(s.sale_date)]! += s.birds_count;
        let alive = batch.initial_chick_count;
        for (const [i, row] of daily.entries()) {
            row.birds = alive;
            alive -= lost[i]!;
            row.feed_cost = Number(row.feed_cost.toFixed(2));
            row.medicine_cost = Number(row.medicine_cost.toFixed(2));
            row.vaccine_cost = Number(row.vaccine_cost.toFixed(2));
            row.other_cost = Number(row.other_cost.toFixed(2));
            row.feed_kg = Number(row.feed_kg.toFixed(3));
        }

        return {
            items: rows,
            stays: stays
                .map((s) => ({ ...s, house_name: houseName.get(s.house_id) ?? "Unknown house" }))
                .sort((a, b) => a.from.getTime() - b.from.getTime()),
            total_cost: money(total),
            cost_by_category: {
                feed: money(byBucket.FEED),
                medicine: money(byBucket.MEDICINE),
                vaccine: money(byBucket.VACCINE),
                other: money(byBucket.OTHER),
            },
            /** Items with no purchase price to cost them at -- left out of total_cost. */
            uncosted_items: rows.filter((r) => r.cost === null).map((r) => r.item_name),
            daily,
        };
    },
};
