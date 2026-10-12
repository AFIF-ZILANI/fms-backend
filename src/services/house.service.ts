import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import { getLocationStock } from "@lib/stock-balance";
import type {
    CreateHouseInput,
    UpdateHouseInput,
    ListHousesQuery,
} from "@validators/house.validator";

export const HouseService = {
    /**
     * Each house carries its current occupants so the houses table can show the
     * running batch, how many birds went in vs. how many are still alive, when
     * the house started running, and when it should free up -- without the
     * client fanning out one request per house.
     */
    async getAll(query: ListHousesQuery) {
        const where = {
            ...(query.type !== undefined && { type: query.type }),
            ...(query.is_active !== undefined && { is_active: query.is_active === "true" }),
            ...(query.phase !== undefined && { phase: query.phase }),
            ...(query.is_available !== undefined && {
                batchHouseBalances: {
                    [query.is_available === "true" ? "none" : "some"]: { quantity: { gt: 0 } },
                },
            }),
        };
        const [houses, total] = await Promise.all([
            prisma.houses.findMany({
                where,
                orderBy: { created_at: "desc" },
                include: {
                    batchHouseBalances: {
                        where: { quantity: { gt: 0 } },
                        include: {
                            batch: {
                                select: {
                                    id: true,
                                    batch_code: true,
                                    status: true,
                                    starting_date: true,
                                    expected_selling_date: true,
                                },
                            },
                        },
                    },
                },
                ...toSkipTake(query),
            }),
            prisma.houses.count({ where }),
        ]);

        const occupiedPairs = houses.flatMap((h) =>
            h.batchHouseBalances.map((b) => ({ house_id: h.id, batch_id: b.batch_id })),
        );
        // "Placed" is every bird ever moved INTO this house for the batch still
        // in it (the INITIAL placement included) -- alive is what's left after
        // mortality and transfers out, so the two together show the loss.
        const inbound = occupiedPairs.length
            ? await prisma.batchHouseAllocation.findMany({
                  where: {
                      to_house_id: { in: [...new Set(occupiedPairs.map((p) => p.house_id))] },
                      batch_id: { in: [...new Set(occupiedPairs.map((p) => p.batch_id))] },
                  },
                  select: { to_house_id: true, batch_id: true, quantity: true, occurred_at: true },
              })
            : [];

        const emptyHouseIds = houses.filter((h) => h.batchHouseBalances.length === 0).map((h) => h.id);
        // A house empties the moment its last balance hits zero -- that covers
        // birds leaving by sale or mortality too, which an outbound allocation
        // row wouldn't.
        const vacated = emptyHouseIds.length
            ? await prisma.batchHouseBalance.groupBy({
                  by: ["house_id"],
                  where: { house_id: { in: emptyHouseIds }, quantity: 0 },
                  _max: { updated_at: true },
              })
            : [];
        const vacatedByHouse = new Map(vacated.map((v) => [v.house_id, v._max.updated_at]));

        return {
            houses: houses.map(({ batchHouseBalances, ...house }) => ({
                ...house,
                occupants: batchHouseBalances.map((balance) => {
                    const moves = inbound.filter(
                        (a) => a.to_house_id === house.id && a.batch_id === balance.batch_id,
                    );
                    const since = moves.reduce<Date | null>(
                        (earliest, move) =>
                            earliest === null || move.occurred_at < earliest ? move.occurred_at : earliest,
                        null,
                    );
                    return {
                        batch_id: balance.batch_id,
                        batch_code: balance.batch.batch_code,
                        batch_status: balance.batch.status,
                        alive: balance.quantity,
                        placed: moves.reduce((sum, move) => sum + move.quantity, 0),
                        since: since ?? balance.batch.starting_date,
                        expected_selling_date: balance.batch.expected_selling_date,
                    };
                }),
                last_vacated_at: vacatedByHouse.get(house.id) ?? null,
            })),
            meta: buildMeta(total, query),
        };
    },

    async getById(id: string) {
        const house = await prisma.houses.findUnique({ where: { id } });
        if (!house) throw AppError.notFound("House");
        return house;
    },

    /** The coded (QR) units physically in this house and not yet used, per item: how many, and how much
     *  they hold when every lot has a bottle count. "In" a house = its latest move was into this house
     *  (a return to the warehouse, or a move on to another house, takes it out). A unit already IN_USE
     *  has been drawn on and no longer counts. */
    async getCodedStock(id: string) {
        const house = await prisma.houses.findUnique({ where: { id } });
        if (!house) throw AppError.notFound("House");

        const rows = await prisma.$queryRaw<
            {
                item_id: string;
                item_name: string;
                item_unit: string;
                pack_unit: string | null;
                units: number;
                unsized: number;
                quantity: string | null;
            }[]
        >`
            SELECT pi.item_id,
                   i.name AS item_name,
                   i.unit AS item_unit,
                   CASE WHEN COUNT(DISTINCT pi.unit) = 1 THEN MIN(pi.unit) END AS pack_unit,
                   COUNT(*)::int AS units,
                   COUNT(*) FILTER (WHERE pi.unit_count IS NULL)::int AS unsized,
                   SUM(pi.base_quantity / NULLIF(pi.unit_count, 0))::text AS quantity
            FROM "StockUnit" su
            JOIN LATERAL (
                SELECT a.house_id FROM "StockHouseAllocation" a
                WHERE a.stock_unit_id = su.id
                ORDER BY a.occurred_at DESC, a.created_at DESC
                LIMIT 1
            ) cur ON TRUE
            JOIN "PurchaseItem" pi ON pi.id = su.purchase_item_id
            JOIN "Item" i ON i.id = pi.item_id
            WHERE cur.house_id = ${id} AND su.status = 'IN_STOCK'
            GROUP BY pi.item_id, i.name, i.unit
            ORDER BY i.name`;

        return rows.map((r) => ({
            item_id: r.item_id,
            item_name: r.item_name,
            /** The item's own unit, which `quantity` is in. */
            unit: r.item_unit,
            /** What one coded unit is (BOTTLE), when every unit of this item here is the same. */
            pack_unit: r.pack_unit,
            units: r.units,
            /** Null when any lot of this item has no bottle count yet, so its size isn't known. */
            quantity: r.unsized > 0 || r.quantity === null ? null : Number(r.quantity),
        }));
    },

    async getStock(id: string) {
        const house = await prisma.houses.findUnique({ where: { id } });
        if (!house) throw AppError.notFound("House");

        const balances = await getLocationStock("HOUSE", id);
        const nonZero = balances.filter((b) => b.balance.isPositive());
        const items = await prisma.item.findMany({
            where: { id: { in: nonZero.map((b) => b.item_id) } },
            select: { id: true, name: true, unit: true },
        });
        const itemById = new Map(items.map((i) => [i.id, i]));

        return nonZero.map((b) => ({
            item_id: b.item_id,
            item_name: itemById.get(b.item_id)?.name ?? "Unknown item",
            unit: itemById.get(b.item_id)?.unit ?? "",
            balance: b.balance,
        }));
    },

    // (type, number) is unique: Brooder 1 and Grower 1 are different sheds, two Brooder 1s are not.
    // A clash is a 409 from the database's own unique, not a pre-check that two requests could race.
    async create(data: CreateHouseInput) {
        try {
            return await prisma.houses.create({
                data: {
                    name: data.name,
                    type: data.type,
                    number: data.number,
                    ...(data.capacity !== undefined && { capacity: data.capacity }),
                },
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    async update(id: string, data: UpdateHouseInput) {
        const house = await prisma.houses.findUnique({ where: { id } });
        if (!house) throw AppError.notFound("House");

        const { name, type, number, capacity, phase } = data;
        if (!name && !type && number === undefined && capacity === undefined && !phase) {
            throw AppError.badRequest("No update fields provided");
        }

        try {
            return await prisma.houses.update({
                where: { id },
                data: {
                    ...(name && { name }),
                    ...(type && { type }),
                    ...(number !== undefined && { number }),
                    ...(capacity !== undefined && { capacity }),
                    ...(phase && { phase }),
                },
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    async setActive(id: string, is_active: boolean) {
        const house = await prisma.houses.findUnique({ where: { id } });
        if (!house) throw AppError.notFound("House");
        return prisma.houses.update({ where: { id }, data: { is_active } });
    },

    /**
     * Hard delete -- only for houses registered by mistake. The schema says a
     * house is never hard-deleted once history attaches. Every FK that points at a house is
     * onDelete: Restrict, so the database refuses too (including a delete that races the
     * count); counting every attachment first is what gives a readable error.
     * StockLedger is polymorphic (location_type/location_id, no FK) -- counted
     * separately for the same reason.
     */
    async remove(id: string) {
        const house = await prisma.houses.findUnique({
            where: { id },
            select: {
                _count: {
                    select: {
                        weightRecords: true,
                        allocationsTo: true,
                        allocationsFrom: true,
                        batchHouseBalances: true,
                        mortalityLogs: true,
                        consumptions: true,
                        environmentRecords: true,
                        stockHouseAllocations: true,
                        inventoryAdjustments: true,
                        birdSales: true,
                    },
                },
            },
        });
        if (!house) throw AppError.notFound("House");

        const ledgerRows = await prisma.stockLedger.count({
            where: { location_type: "HOUSE", location_id: id },
        });
        const attached = ledgerRows + Object.values(house._count).reduce((sum, n) => sum + n, 0);
        if (attached > 0) {
            throw AppError.conflict(
                "House has recorded history and cannot be deleted. Deactivate it instead.",
            );
        }

        return prisma.houses.delete({ where: { id } });
    },
};
