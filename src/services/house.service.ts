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
        const nonZero = balances.filter((b) => !b.balance.isZero());
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
};
