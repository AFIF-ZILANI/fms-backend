import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import { normalizeKey } from "@lib/normalize";
import type { CreateItemInput, UpdateItemInput, ListItemsQuery } from "@validators/item.validator";

const include = { suppliers: true } as const;

export const ItemService = {
    async getAll(query: ListItemsQuery) {
        const where = {
            ...(query.category !== undefined && { category: query.category }),
            ...(query.is_active !== undefined && { is_active: query.is_active === "true" }),
        };
        const [items, total] = await Promise.all([
            prisma.item.findMany({
                where,
                orderBy: { created_at: "desc" },
                ...toSkipTake(query),
            }),
            prisma.item.count({ where }),
        ]);
        return { items, meta: buildMeta(total, query) };
    },

    async getById(id: string) {
        const item = await prisma.item.findUnique({ where: { id }, include });
        if (!item) throw AppError.notFound("Item");
        return item;
    },

    async create(data: CreateItemInput) {
        try {
            return await prisma.item.create({
                data: {
                    name: data.name,
                    normalized_key: normalizeKey(data.name),
                    category: data.category,
                    unit: data.unit,
                    ...(data.reorder_level !== undefined && { reorder_level: data.reorder_level }),
                    ...(data.preferred_reorder_qty !== undefined && {
                        preferred_reorder_qty: data.preferred_reorder_qty,
                    }),
                    ...(data.lead_time_days !== undefined && {
                        lead_time_days: data.lead_time_days,
                    }),
                    ...(data.supplier_ids !== undefined && {
                        suppliers: { connect: data.supplier_ids.map((id) => ({ id })) },
                    }),
                },
                include,
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    async update(id: string, data: UpdateItemInput) {
        const item = await prisma.item.findUnique({ where: { id } });
        if (!item) throw AppError.notFound("Item");

        const {
            name,
            category,
            unit,
            reorder_level,
            preferred_reorder_qty,
            lead_time_days,
            supplier_ids,
        } = data;
        if (
            !name &&
            !category &&
            !unit &&
            reorder_level === undefined &&
            preferred_reorder_qty === undefined &&
            lead_time_days === undefined &&
            !supplier_ids
        ) {
            throw AppError.badRequest("No update fields provided");
        }

        try {
            return await prisma.item.update({
                where: { id },
                data: {
                    ...(name && { name, normalized_key: normalizeKey(name) }),
                    ...(category && { category }),
                    ...(unit && { unit }),
                    ...(reorder_level !== undefined && { reorder_level }),
                    ...(preferred_reorder_qty !== undefined && { preferred_reorder_qty }),
                    ...(lead_time_days !== undefined && { lead_time_days }),
                    ...(supplier_ids !== undefined && {
                        suppliers: { set: supplier_ids.map((id) => ({ id })) },
                    }),
                },
                include,
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    async setActive(id: string, is_active: boolean) {
        const item = await prisma.item.findUnique({ where: { id } });
        if (!item) throw AppError.notFound("Item");
        return prisma.item.update({ where: { id }, data: { is_active }, include });
    },
};
