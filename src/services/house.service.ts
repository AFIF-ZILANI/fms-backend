import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { toSkipTake, buildMeta } from "@lib/pagination";
import { getLocationStock } from "@lib/stock-balance";
import type {
    CreateHouseInput,
    UpdateHouseInput,
    ListHousesQuery,
} from "@validators/house.validator";

export const HouseService = {
    async getAll(query: ListHousesQuery) {
        const where = {
            ...(query.type !== undefined && { type: query.type }),
            ...(query.is_active !== undefined && { is_active: query.is_active === "true" }),
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
                ...toSkipTake(query),
            }),
            prisma.houses.count({ where }),
        ]);
        return { houses, meta: buildMeta(total, query) };
    },

    async getById(id: string) {
        const house = await prisma.houses.findUnique({ where: { id } });
        if (!house) throw AppError.notFound("House");
        return house;
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

    // No uniqueness constraint on Houses (no @@unique in schema) -- create
    // can't collide, so no error mapping needed here.
    async create(data: CreateHouseInput) {
        return prisma.houses.create({
            data: {
                name: data.name,
                type: data.type,
                number: data.number,
                ...(data.capacity !== undefined && { capacity: data.capacity }),
            },
        });
    },

    async update(id: string, data: UpdateHouseInput) {
        const house = await prisma.houses.findUnique({ where: { id } });
        if (!house) throw AppError.notFound("House");

        const { name, type, number, capacity } = data;
        if (!name && !type && number === undefined && capacity === undefined) {
            throw AppError.badRequest("No update fields provided");
        }

        return prisma.houses.update({
            where: { id },
            data: {
                ...(name && { name }),
                ...(type && { type }),
                ...(number !== undefined && { number }),
                ...(capacity !== undefined && { capacity }),
            },
        });
    },

    async setActive(id: string, is_active: boolean) {
        const house = await prisma.houses.findUnique({ where: { id } });
        if (!house) throw AppError.notFound("House");
        return prisma.houses.update({ where: { id }, data: { is_active } });
    },

    /**
     * Hard delete -- only for houses registered by mistake. The schema says a
     * house is never hard-deleted once history attaches, and the FKs alone
     * won't stop us (BatchHouseAllocation is SetNull, InventoryAdjustment is
     * Cascade), so count every attachment ourselves and refuse if any exist.
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
