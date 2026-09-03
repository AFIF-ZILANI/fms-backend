import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type {
    BindStockUnitInput,
    ListStockUnitsQuery,
    SetStockUnitStatusInput,
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

    /** Binds a blank unit to a purchase lot -- UNASSIGNED -> IN_STOCK. Refused for a lot whose
     *  item isn't flagged is_unit_tracked, so a bulk item (feed, husk) can't end up QR-coded
     *  alongside its own aggregate StockLedger tracking. */
    async bind(id: string, input: BindStockUnitInput) {
        const unit = await prisma.stockUnit.findUnique({ where: { id } });
        if (!unit) throw AppError.notFound("StockUnit");
        if (unit.status !== "UNASSIGNED") {
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
            return await prisma.stockUnit.update({
                where: { id },
                data: {
                    purchase_item_id: input.purchase_item_id,
                    status: "IN_STOCK",
                    bound_at: new Date(),
                    ...(input.bound_by_id !== undefined && { bound_by_id: input.bound_by_id }),
                },
            });
        } catch (err) {
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
    ) {
        const unit = await prisma.stockUnit.findUnique({
            where: { id },
            include: { purchase_item: true },
        });
        if (!unit) throw AppError.notFound("StockUnit");

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

        const latest = await prisma.stockHouseAllocation.findFirst({
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
            house_id === null ? "RETURN" : currentHouseId === null ? "ALLOCATION" : "REALLOCATION";

        try {
            return await prisma.stockHouseAllocation.create({
                data: {
                    stock_unit_id: id,
                    house_id,
                    type,
                    idempotency_key,
                    ...(stock_transfer_id !== undefined && { stock_transfer_id }),
                },
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    async dispose(id: string) {
        const unit = await prisma.stockUnit.findUnique({ where: { id } });
        if (!unit) throw AppError.notFound("StockUnit");
        if (unit.status === "DISPOSED") throw AppError.conflict("StockUnit is already disposed");
        return prisma.stockUnit.update({ where: { id }, data: { status: "DISPOSED" } });
    },

    /** Free status set for the manual "change status" action -- no transition guards (unlike
     *  bind/dispose), the operator picks the target status directly. */
    async setStatus(id: string, status: SetStockUnitStatusInput["status"]) {
        const unit = await prisma.stockUnit.findUnique({ where: { id } });
        if (!unit) throw AppError.notFound("StockUnit");
        return prisma.stockUnit.update({ where: { id }, data: { status } });
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
