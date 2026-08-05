import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type {
    CreateWarehouseInput,
    UpdateWarehouseInput,
    ListWarehousesQuery,
} from "@validators/warehouse.validator";

// No is_active/delete here -- a warehouse is just a name, and InventoryAdjustment
// cascades on delete, so removing one would silently destroy adjustment history.
// Create + rename only; add lifecycle management if a real need shows up.
export const WarehouseService = {
    async getAll(query: ListWarehousesQuery) {
        const [warehouses, total] = await Promise.all([
            prisma.warehouses.findMany({ orderBy: { created_at: "desc" }, ...toSkipTake(query) }),
            prisma.warehouses.count(),
        ]);
        return { warehouses, meta: buildMeta(total, query) };
    },

    async getById(id: string) {
        const warehouse = await prisma.warehouses.findUnique({ where: { id } });
        if (!warehouse) throw AppError.notFound("Warehouse");
        return warehouse;
    },

    async create(data: CreateWarehouseInput) {
        return prisma.warehouses.create({ data });
    },

    async update(id: string, data: UpdateWarehouseInput) {
        const warehouse = await prisma.warehouses.findUnique({ where: { id } });
        if (!warehouse) throw AppError.notFound("Warehouse");
        if (!data.name) throw AppError.badRequest("No update fields provided");
        return prisma.warehouses.update({ where: { id }, data: { name: data.name } });
    },
};
