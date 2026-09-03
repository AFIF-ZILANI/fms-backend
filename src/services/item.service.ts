import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import { normalizeKey } from "@lib/normalize";
import type {
    CreateItemInput,
    UpdateItemInput,
    ListItemsQuery,
    CreateItemUnitInput,
} from "@validators/item.validator";
import { Prisma } from "../../prisma/generated/prisma/client";
import { getItemBalances, getStockByLocation } from "@lib/stock-balance";
import { GENERIC_ITEM_UNITS } from "@lib/enums";

const include = { suppliers: true, itemUnits: true } as const;

export const ItemService = {
    async getAll(query: ListItemsQuery) {
        const where = {
            ...(query.category !== undefined && { category: query.category }),
            ...(query.is_active !== undefined && { is_active: query.is_active === "true" }),
            ...(query.is_unit_tracked !== undefined && {
                is_unit_tracked: query.is_unit_tracked === "true",
            }),
        };
        const [items, total] = await Promise.all([
            prisma.item.findMany({
                where,
                include,
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
                    ...(data.meta_data !== undefined && { meta_data: data.meta_data }),
                    ...(data.is_unit_tracked !== undefined && {
                        is_unit_tracked: data.is_unit_tracked,
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
            reorder_level,
            preferred_reorder_qty,
            lead_time_days,
            supplier_ids,
            meta_data,
            is_unit_tracked,
        } = data;
        if (
            !name &&
            !category &&
            reorder_level === undefined &&
            preferred_reorder_qty === undefined &&
            lead_time_days === undefined &&
            !supplier_ids &&
            meta_data === undefined &&
            is_unit_tracked === undefined
        ) {
            throw AppError.badRequest("No update fields provided");
        }

        try {
            return await prisma.item.update({
                where: { id },
                data: {
                    ...(name && { name, normalized_key: normalizeKey(name) }),
                    ...(category && { category }),
                    ...(reorder_level !== undefined && { reorder_level }),
                    ...(preferred_reorder_qty !== undefined && { preferred_reorder_qty }),
                    ...(lead_time_days !== undefined && { lead_time_days }),
                    ...(supplier_ids !== undefined && {
                        suppliers: { set: supplier_ids.map((id) => ({ id })) },
                    }),
                    ...(meta_data !== undefined && { meta_data }),
                    ...(is_unit_tracked !== undefined && { is_unit_tracked }),
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

    /** Active items under their reorder level, balance computed from StockLedger. No pagination -- this list is meant to be short. */
    async getLowStock() {
        const items = await prisma.item.findMany({
            where: { is_active: true, reorder_level: { not: null } },
            orderBy: { name: "asc" },
        });
        const balances = await getItemBalances(items.map((i) => i.id));
        return items
            .map((item) => ({
                ...item,
                current_balance: balances.get(item.id) ?? new Prisma.Decimal(0),
            }))
            .filter((item) => item.current_balance.lessThan(item.reorder_level!));
    },

    /** Per-(item, location) on-hand stock for every item, feeding the catalog's warehouse/house
     * columns and their breakdown sheets in one call. See getStockByLocation for what's excluded. */
    async getStockByLocation() {
        return getStockByLocation();
    },
};

export const ItemUnitService = {
    async create(data: CreateItemUnitInput) {
        const item = await prisma.item.findUnique({
            where: { id: data.item_id },
            select: { unit: true },
        });
        if (!item) throw AppError.badRequest("item_id does not reference an existing record");
        if (item.unit === data.unit) {
            throw AppError.badRequest(
                "unit already is this item's base unit -- no conversion factor needed",
            );
        }

        const unitRow = await prisma.unit.findUnique({ where: { code: data.unit } });
        if (!unitRow) throw AppError.badRequest("unit does not reference a known unit code");
        if (unitRow.is_base) {
            throw AppError.badRequest(
                `"${data.unit}" is a base unit and can't be added as a conversion`,
            );
        }
        // A unit tied to a specific base family (e.g. LITER -> ML) can't be added to an item whose
        // own base unit is different (e.g. G) -- GENERIC_ITEM_UNITS (e.g. Container) are the only
        // exception, valid under any family.
        if (!GENERIC_ITEM_UNITS.has(unitRow.code) && unitRow.base_unit !== item.unit) {
            throw AppError.badRequest(
                `"${data.unit}" belongs to the ${unitRow.base_unit} family, not this item's base unit "${item.unit}"`,
            );
        }
        // A fixed_factor is a physical constant (Liter=1000, Ft=0.3048, ...) -- always use it over
        // whatever the client sent, so a typo can't desync an item's conversion from reality.
        const factor_to_base = unitRow.fixed_factor ?? data.factor_to_base;

        try {
            return await prisma.itemUnit.create({ data: { ...data, factor_to_base } });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    async remove(id: string) {
        const link = await prisma.itemUnit.findUnique({ where: { id } });
        if (!link) throw AppError.notFound("ItemUnit conversion");
        await prisma.itemUnit.delete({ where: { id } });
    },
};
