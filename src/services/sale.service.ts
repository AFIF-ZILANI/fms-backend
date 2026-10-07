import prisma from "@lib/db";
import { recordPaidAtCreate, requirePaidInstrument } from "@lib/paid-at-create";
import { Prisma } from "../../prisma/generated/prisma/client";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import { toBaseQuantity } from "@lib/unit-conversion";
import { getItemLocationBalance } from "@lib/stock-balance";
import { StockLedgerService } from "@services/stock-ledger.service";
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
        // Unfiltered (the common Sales-page load): every SALE payment belongs to some sale, so
        // there is no need to ship every sale id into an IN list.
        const unfiltered = Object.keys(where).length === 0;
        const [aggregate, ids] = await Promise.all([
            prisma.sale.aggregate({
                where,
                _count: { _all: true },
                _sum: { due_amount: true, total: true },
            }),
            // ponytail: for a filtered summary the id list feeds the payment aggregate so it nets
            // off only its own sales. Swap for a raw JOIN if a filter ever matches thousands.
            unfiltered ? [] : prisma.sale.findMany({ where, select: { id: true } }),
        ]);
        const paid = await prisma.payment.aggregate({
            where: {
                ref_type: "SALE",
                ...(!unfiltered && { ref_id: { in: ids.map((row) => row.id) } }),
            },
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

    /** Posts a StockLedger OUT per line from the chosen warehouse, in the sale's own transaction. Lines of the
     * same item are checked together so two half-lines can't each pass and overdraw. Coded (unit-tracked) items
     * leave the ledger here too; their StockUnit status is still a manual step (ponytail: no unit picker on sales). */
    async deductStock(tx: Prisma.TransactionClient, sale_id: string, data: CreateSaleInput) {
        const needed = new Map<string, Prisma.Decimal>();
        for (const line of data.items) {
            const base = await toBaseQuantity(tx, line.item_id, line.unit, line.quantity, "USABLE");
            needed.set(line.item_id, (needed.get(line.item_id) ?? new Prisma.Decimal(0)).plus(base));
        }
        for (const [item_id, quantity] of needed) {
            const available = await getItemLocationBalance(tx, item_id, "WAREHOUSE", data.warehouse_id);
            if (available.lessThan(quantity)) {
                throw AppError.conflict(`Only ${available.toString()} of this item is in stock at that warehouse`);
            }
            await StockLedgerService.record(tx, {
                item_id,
                quantity,
                direction: "OUT",
                reason: "SALE",
                ref_type: "SALE",
                ref_id: sale_id,
                location_type: "WAREHOUSE",
                location_id: data.warehouse_id,
            });
        }
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
        if (total.minus(paid_amount).isNegative()) {
            throw AppError.badRequest("paid_amount cannot exceed the sale total");
        }
        requirePaidInstrument(paid_amount, data.paid_to_instrument_id, "paid_to_instrument_id", "SALE");

        try {
            return await prisma.$transaction(async (tx) => {
                const sale = await tx.sale.create({
                    data: {
                        sale_date: data.sale_date,
                        total,
                        // Stored as "nothing paid yet": what was paid at creation is a Payment against an
                        // account (below), so the books and the cash position both see it.
                        paid_amount: new Prisma.Decimal(0),
                        due_amount: total,
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

                await SaleService.deductStock(tx, sale.id, data);

                await recordPaidAtCreate(tx, {
                    ref_type: "SALE",
                    ref_id: sale.id,
                    amount: paid_amount,
                    instrument_id: data.paid_to_instrument_id,
                    date: data.sale_date,
                    actor_id: data.recorded_by_id,
                });

                return tx.sale.findUniqueOrThrow({ where: { id: sale.id }, include });
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },
};
