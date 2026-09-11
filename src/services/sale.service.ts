import prisma from "@lib/db";
import { Prisma } from "../../prisma/generated/prisma/client";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type {
    CreateSaleInput,
    ListSalesQuery,
    SalesSummaryQuery,
} from "@validators/sale.validator";

const include = { items: { include: { item: true } }, customer: true } as const;

function buildWhere(query: SalesSummaryQuery) {
    return {
        ...(query.customer_id !== undefined && { customer_id: query.customer_id }),
        ...((query.date_from !== undefined || query.date_to !== undefined) && {
            sale_date: {
                ...(query.date_from !== undefined && { gte: query.date_from }),
                ...(query.date_to !== undefined && { lte: query.date_to }),
            },
        }),
        ...(query.item_category !== undefined && {
            items: { some: { item: { category: query.item_category } } },
        }),
    };
}

// Sale/SaleItem are append-only, same as Purchase/PurchaseItem -- no update.
export const SaleService = {
    async getAll(query: ListSalesQuery) {
        const where = buildWhere(query);
        const [sales, total] = await Promise.all([
            prisma.sale.findMany({
                where,
                include,
                orderBy: { created_at: "desc" },
                ...toSkipTake(query),
            }),
            prisma.sale.count({ where }),
        ]);
        return { sales, meta: buildMeta(total, query) };
    },

    /** Whole-set totals for the Sales KPI row. The list endpoint's `limit` is
     * capped at 100, so these can never be summed client-side from a page of
     * results. total_due nets every SALE payment off the due snapshots --
     * exact only because PaymentService.create refuses to overpay a row, so
     * no row's outstanding can be negative and skew the sum. */
    async summary(query: SalesSummaryQuery) {
        const where = buildWhere(query);
        const [aggregate, ids] = await Promise.all([
            prisma.sale.aggregate({
                where,
                _count: { _all: true },
                _sum: { due_amount: true, total: true },
            }),
            // ponytail: id list feeds the payment aggregate so a filtered
            // summary nets off only its own sales. Swap for a raw JOIN if the
            // sale count ever makes this list expensive to ship around.
            prisma.sale.findMany({ where, select: { id: true } }),
        ]);
        const paid = await prisma.payment.aggregate({
            where: { ref_type: "SALE", ref_id: { in: ids.map((row) => row.id) } },
            _sum: { amount: true },
        });
        const due = (aggregate._sum.due_amount ?? new Prisma.Decimal(0)).minus(
            paid._sum.amount ?? new Prisma.Decimal(0),
        );
        return {
            count: aggregate._count._all,
            total_revenue: (aggregate._sum.total ?? new Prisma.Decimal(0)).toString(),
            total_due: due.toString(),
        };
    },

    async getById(id: string) {
        const sale = await prisma.sale.findUnique({ where: { id }, include });
        if (!sale) throw AppError.notFound("Sale");
        return sale;
    },

    async create(data: CreateSaleInput) {
        const itemsWithTotals = data.items.map((item) => ({
            ...item,
            total_price: new Prisma.Decimal(item.quantity).times(item.unit_price),
        }));
        const total = itemsWithTotals.reduce(
            (sum, item) => sum.plus(item.total_price),
            new Prisma.Decimal(0),
        );
        const paid_amount = new Prisma.Decimal(data.paid_amount);
        const due_amount = total.minus(paid_amount);
        if (due_amount.isNegative()) {
            throw AppError.badRequest("paid_amount cannot exceed the sale total");
        }

        try {
            return await prisma.$transaction(async (tx) => {
                const sale = await tx.sale.create({
                    data: {
                        sale_date: data.sale_date,
                        total,
                        paid_amount,
                        due_amount,
                        recorded_by_id: data.recorded_by_id,
                        ...(data.customer_id !== undefined && { customer_id: data.customer_id }),
                    },
                });

                await tx.saleItem.createMany({
                    data: itemsWithTotals.map((item) => ({
                        sale_id: sale.id,
                        item_id: item.item_id,
                        quantity: item.quantity,
                        unit: item.unit,
                        unit_price: item.unit_price,
                        total_price: item.total_price,
                    })),
                });

                return tx.sale.findUniqueOrThrow({ where: { id: sale.id }, include });
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },
};
