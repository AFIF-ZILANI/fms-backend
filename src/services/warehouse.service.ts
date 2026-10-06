import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { toSkipTake, buildMeta } from "@lib/pagination";
import { getLocationStock } from "@lib/stock-balance";
import type {
    CreateWarehouseInput,
    UpdateWarehouseInput,
    ListWarehousesQuery,
} from "@validators/warehouse.validator";

// No is_active here -- a warehouse is just a name. Delete is guarded rather than
// absent: remove() refuses a warehouse that has been used (with a clear message), leaving
// delete usable only for a mis-created (never-used) row. InventoryAdjustment is
// onDelete: Restrict, so the database refuses too -- including a delete that races the count.
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

    async getStock(id: string) {
        const warehouse = await prisma.warehouses.findUnique({ where: { id } });
        if (!warehouse) throw AppError.notFound("Warehouse");

        const balances = await getLocationStock("WAREHOUSE", id);
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

    async create(data: CreateWarehouseInput) {
        return prisma.warehouses.create({ data });
    },

    /**
     * Hard delete -- a mis-created warehouse (typo, duplicate) only. There is no
     * is_active to fall back on, so this is the sole way to remove one, which is
     * exactly why the guard matters. InventoryAdjustment is onDelete: Restrict, so the
     * database is the backstop; the count here exists to give a readable error.
     * StockLedger is polymorphic (location_type/location_id, no FK) -- counted
     * separately. Transfers need no separate count: TransferService writes a ledger
     * row tagged at each endpoint, so a warehouse that was ever a transfer end shows
     * up in that count.
     */
    async remove(id: string) {
        const warehouse = await prisma.warehouses.findUnique({
            where: { id },
            select: { _count: { select: { inventoryAdjustments: true, purchases: true } } },
        });
        if (!warehouse) throw AppError.notFound("Warehouse");

        const ledgerRows = await prisma.stockLedger.count({
            where: { location_type: "WAREHOUSE", location_id: id },
        });
        const attached = ledgerRows + Object.values(warehouse._count).reduce((sum, n) => sum + n, 0);
        if (attached > 0) {
            throw AppError.conflict(
                "Warehouse has recorded stock history and cannot be deleted. Rename it instead.",
            );
        }

        return prisma.warehouses.delete({ where: { id } });
    },

    async update(id: string, data: UpdateWarehouseInput) {
        const warehouse = await prisma.warehouses.findUnique({ where: { id } });
        if (!warehouse) throw AppError.notFound("Warehouse");
        if (!data.name) throw AppError.badRequest("No update fields provided");
        return prisma.warehouses.update({ where: { id }, data: { name: data.name } });
    },
};
