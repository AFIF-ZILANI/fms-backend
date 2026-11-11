import prisma from "@lib/db";
import { assertBatchOpen } from "@lib/batch-guards";
import { audit } from "@lib/audit";
import { recordPaidAtCreate, requirePaidInstrument } from "@lib/paid-at-create";
import { Prisma } from "../../prisma/generated/prisma/client";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import { toBaseQuantity } from "@lib/unit-conversion";
import { getItemLocationBalance } from "@lib/stock-balance";
import { StockLedgerService } from "@services/stock-ledger.service";
import { isNonDepleting } from "@lib/coded-stock";
import { soldBottles } from "@services/sale-scan.service";
import type {
    CreateSaleInput,
    ListSalesQuery,
    SalesSummaryQuery,
    SellableQuery,
} from "@validators/sale.validator";

const include = { items: { include: { item: true } }, customer: true } as const;

/** Every line must be an item of the sale's kind, and each kind brings its own rules: QR lines are whole bottles
 * that exist sealed (they leave stock later, one scan at a time), bought stock needs a warehouse and units. */
async function checkKind(tx: Prisma.TransactionClient, data: CreateSaleInput) {
    const found = await tx.item.findMany({
        where: { id: { in: data.items.map((line) => line.item_id) } },
        select: { id: true, name: true, category: true, is_unit_tracked: true, is_farm_made: true },
    });
    const byId = new Map(found.map((item) => [item.id, item]));
    const bottles = new Map<string, number>();
    for (const line of data.items) {
        const item = byId.get(line.item_id);
        if (!item) throw AppError.badRequest("item_id does not reference an existing record");
        const fits =
            data.kind === "CODED"
                ? item.is_unit_tracked
                : data.kind === "FARM_MADE"
                  ? item.is_farm_made
                  : !item.is_unit_tracked && !item.is_farm_made;
        if (!fits) throw AppError.badRequest(`${item.name} can't be sold on a ${KIND_WORDS[data.kind]} sale`);
        if (data.kind === "CODED") {
            if (isNonDepleting(item.category)) throw AppError.badRequest("Equipment can't be sold yet");
            if (!Number.isInteger(line.quantity))
                throw AppError.badRequest(`${item.name}: sell whole bottles`);
            bottles.set(item.id, (bottles.get(item.id) ?? 0) + line.quantity);
        } else if (line.unit === undefined) {
            throw AppError.badRequest(`${item.name}: choose a unit`);
        }
    }
    if (data.kind === "STOCK" && data.warehouse_id === undefined)
        throw AppError.badRequest("Choose the warehouse the stock comes from");
    // ponytail: a soft check -- two QR sales can both pass and then compete for the same bottles; whoever scans
    // first wins. Fine at this farm's volume; reserve bottles per sale if it ever bites.
    for (const [item_id, wanted] of bottles) {
        const sealed = await tx.stockUnit.count({ where: { status: "BOUND", purchase_item: { item_id } } });
        if (sealed < wanted)
            throw AppError.conflict(`Only ${sealed} sealed ${byId.get(item_id)!.name} bottles are in stock`);
    }
}

const KIND_WORDS = { CODED: "QR items", STOCK: "bought stock", FARM_MADE: "farm-made" } as const;

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
        ...(query.kind !== undefined && { kind: query.kind }),
    };
}

/** Bottles scanned out per sale line, one query for a whole page of sales. */
async function scannedByLine(lineIds: string[]) {
    const counts = await prisma.stockUnit.groupBy({
        by: ["sale_item_id"],
        where: { sale_item_id: { in: lineIds } },
        _count: { _all: true },
    });
    return new Map(counts.map((c) => [c.sale_item_id, c._count._all]));
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
        const scanned = await scannedByLine(sales.flatMap((s) => s.items.map((l) => l.id)));
        return {
            sales: sales.map((s) => ({
                ...s,
                // QR sales only: how many bottles the sale needs and how many have been scanned out so far.
                scan:
                    s.kind === "CODED"
                        ? {
                              needed: s.items.reduce((sum, l) => sum + l.quantity.toNumber(), 0),
                              scanned: s.items.reduce((sum, l) => sum + (scanned.get(l.id) ?? 0), 0),
                          }
                        : null,
            })),
            meta: buildMeta(total, query),
        };
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
        const sale = await prisma.sale.findUnique({
            where: { id },
            include: { ...include, warehouse: { select: { id: true, name: true } } },
        });
        if (!sale) throw AppError.notFound("Sale");
        const lineIds = sale.items.map((l) => l.id);
        const scanned = await scannedByLine(lineIds);
        return {
            ...sale,
            items: sale.items.map((l) => ({ ...l, scanned: scanned.get(l.id) ?? 0 })),
            bottles: sale.kind === "CODED" ? await soldBottles(lineIds) : [],
        };
    },

    /** For the Record sale form: sealed bottles per sellable QR item (equipment excluded), or each bought-stock
     *  item's balance in one warehouse, in its base unit. Items with nothing to sell are left out. */
    async sellable(query: SellableQuery): Promise<{ item_id: string; available: number | string }[]> {
        if (query.kind === "CODED") {
            const units = await prisma.stockUnit.findMany({
                where: { status: "BOUND", purchase_item: { item: { is_unit_tracked: true } } },
                select: { purchase_item: { select: { item_id: true, item: { select: { category: true } } } } },
            });
            const counts = new Map<string, number>();
            for (const u of units) {
                if (!u.purchase_item || isNonDepleting(u.purchase_item.item.category)) continue;
                counts.set(u.purchase_item.item_id, (counts.get(u.purchase_item.item_id) ?? 0) + 1);
            }
            return [...counts].map(([item_id, available]) => ({ item_id, available }));
        }
        const rows = await prisma.stockLedger.groupBy({
            by: ["item_id", "direction"],
            where: {
                location_type: "WAREHOUSE",
                location_id: query.warehouse_id!,
                item: { is_unit_tracked: false, is_farm_made: false },
            },
            _sum: { quantity: true },
        });
        const balance = new Map<string, Prisma.Decimal>();
        for (const r of rows) {
            const q = r._sum.quantity ?? new Prisma.Decimal(0);
            const prev = balance.get(r.item_id) ?? new Prisma.Decimal(0);
            balance.set(r.item_id, r.direction === "IN" ? prev.plus(q) : prev.minus(q));
        }
        return [...balance]
            .filter(([, b]) => b.greaterThan(0))
            .map(([item_id, b]) => ({ item_id, available: b.toString() }));
    },

    /** Posts a StockLedger OUT per line from the chosen warehouse, in the sale's own transaction (STOCK sales
     * only). Lines of the same item are checked together so two half-lines can't each pass and overdraw. */
    async deductStock(tx: Prisma.TransactionClient, sale_id: string, data: CreateSaleInput) {
        const needed = new Map<string, Prisma.Decimal>();
        for (const line of data.items) {
            const base = await toBaseQuantity(tx, line.item_id, line.unit!, line.quantity, "USABLE");
            needed.set(line.item_id, (needed.get(line.item_id) ?? new Prisma.Decimal(0)).plus(base));
        }
        const warehouse_id = data.warehouse_id!;
        for (const [item_id, quantity] of needed) {
            const available = await getItemLocationBalance(tx, item_id, "WAREHOUSE", warehouse_id);
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
                location_id: warehouse_id,
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
                if (data.batch_id !== undefined) await assertBatchOpen(tx, data.batch_id);
                await checkKind(tx, data);
                const sale = await tx.sale.create({
                    data: {
                        sale_date: data.sale_date,
                        total,
                        // Stored as "nothing paid yet": what was paid at creation is a Payment against an
                        // account (below), so the books and the cash position both see it.
                        paid_amount: new Prisma.Decimal(0),
                        due_amount: total,
                        recorded_by_id: data.recorded_by_id,
                        kind: data.kind,
                        ...(data.kind === "STOCK" && { warehouse_id: data.warehouse_id! }),
                        ...(data.customer_id !== undefined && { customer_id: data.customer_id }),
                        ...(data.batch_id !== undefined && { batch_id: data.batch_id }),
                    },
                });

                await tx.saleItem.createMany({
                    data: itemsWithTotals.map((item) => ({
                        sale_id: sale.id,
                        item_id: item.item_id,
                        quantity: item.quantity,
                        unit: data.kind === "CODED" ? null : item.unit!,
                        unit_price: item.unit_price,
                        total_price: item.total_price,
                    })),
                });

                if (data.kind === "STOCK") await SaleService.deductStock(tx, sale.id, data);

                await recordPaidAtCreate(tx, {
                    ref_type: "SALE",
                    ref_id: sale.id,
                    amount: paid_amount,
                    instrument_id: data.paid_to_instrument_id,
                    date: data.sale_date,
                    actor_id: data.recorded_by_id,
                });

                await audit(tx, {
                    table: "Sale",
                    record_id: sale.id,
                    action: "CREATE",
                    actor_id: data.recorded_by_id,
                    note: "Sale recorded",
                    after: {
                        total: total.toString(),
                        paid_at_create: paid_amount.toString(),
                        lines: data.items.length,
                        ...(data.customer_id !== undefined && { customer_id: data.customer_id }),
                    },
                });

                return tx.sale.findUniqueOrThrow({ where: { id: sale.id }, include });
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },
};
