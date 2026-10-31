import prisma from "@lib/db";
import { audit } from "@lib/audit";
import { recordPaidAtCreate, requirePaidInstrument } from "@lib/paid-at-create";
import { Prisma } from "../../prisma/generated/prisma/client";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import { toBaseQuantity } from "@lib/unit-conversion";
import { getItemLocationBalance } from "@lib/stock-balance";
import { StockLedgerService } from "@services/stock-ledger.service";
import { checkExpensePaid, writeExpense } from "@services/expense.service";
import type {
    AddPurchaseChargeInput,
    CreatePurchaseInput,
    ListPurchasesQuery,
    ListPurchaseItemsQuery,
} from "@validators/purchase.validator";

const include = { items: { include: { item: true } }, supplier: true } as const;

type DiscountType = "FLAT" | "PERCENT";

/** Discount amount taken off `gross` -- FLAT is a currency amount, PERCENT is 0-100 of `gross`.
 * Rejects a discount that would take the net below zero (a flat discount bigger than the amount
 * it discounts, or a percent over 100) rather than silently clamping to zero. */
function computeDiscount(
    gross: Prisma.Decimal,
    discount_type: DiscountType | undefined,
    discount_value: number | undefined,
    label: string,
): Prisma.Decimal {
    if (discount_type === undefined) return new Prisma.Decimal(0);
    if (discount_type === "PERCENT") {
        if (discount_value! > 100) {
            throw AppError.badRequest(`${label} discount percent cannot exceed 100`);
        }
        return gross.times(discount_value!).dividedBy(100);
    }
    const flat = new Prisma.Decimal(discount_value!);
    if (flat.greaterThan(gross)) {
        throw AppError.badRequest(`${label} discount cannot exceed the amount it discounts`);
    }
    return flat;
}

// Purchase/PurchaseItem are append-only (system-design-arc.md §6) -- no
// update here, ever. A correction is a new Purchase, not an edit.
export const PurchaseService = {
    async getAll(query: ListPurchasesQuery) {
        const where = {
            // Opening lots aren't purchases anyone made (Purchase.is_opening).
            is_opening: false,
            ...(query.supplier_id !== undefined && { supplier_id: query.supplier_id }),
            ...((query.date_from !== undefined || query.date_to !== undefined) && {
                purchase_date: {
                    ...(query.date_from !== undefined && { gte: query.date_from }),
                    ...(query.date_to !== undefined && { lte: query.date_to }),
                },
            }),
            ...(query.item_category !== undefined && {
                items: { some: { item: { category: query.item_category } } },
            }),
        };
        const [purchases, total] = await Promise.all([
            prisma.purchase.findMany({
                where,
                include,
                orderBy: { created_at: "desc" },
                ...toSkipTake(query),
            }),
            prisma.purchase.count({ where }),
        ]);
        return { purchases, meta: buildMeta(total, query) };
    },

    async getById(id: string) {
        const purchase = await prisma.purchase.findUnique({
            where: { id },
            include: { ...include, charges: { orderBy: { date: "asc" } } },
        });
        if (!purchase) throw AppError.notFound("Purchase");
        return purchase;
    },

    /** Line totals and the purchase total are computed with Prisma.Decimal,
     * not native JS numbers -- this is money math, same precision concern
     * that made Employees.salary a Decimal column instead of Float. */
    async create(data: CreatePurchaseInput) {
        // Each line's total_price is net of its own discount -- this is the figure that feeds the
        // purchase subtotal, StockLedger, and stock valuation, so nothing downstream needs to know
        // discounts exist.
        const itemsWithTotals = data.items.map((item) => {
            const gross = new Prisma.Decimal(item.quantity).times(item.unit_price);
            const discount = computeDiscount(
                gross,
                item.discount_type,
                item.discount_value,
                "Line",
            );
            return { ...item, total_price: gross.minus(discount) };
        });
        const subtotal = itemsWithTotals.reduce(
            (sum, item) => sum.plus(item.total_price),
            new Prisma.Decimal(0),
        );
        const globalDiscount = computeDiscount(
            subtotal,
            data.discount_type,
            data.discount_value,
            "Purchase",
        );
        const total_amount = subtotal.minus(globalDiscount);
        const paid_amount = new Prisma.Decimal(data.paid_amount);
        if (total_amount.minus(paid_amount).isNegative()) {
            throw AppError.badRequest("paid_amount cannot exceed the purchase total");
        }
        requirePaidInstrument(
            paid_amount,
            data.paid_from_instrument_id,
            "paid_from_instrument_id",
            "PURCHASE",
        );
        for (const charge of data.charges ?? []) checkExpensePaid(charge);

        try {
            return await prisma.$transaction(async (tx) => {
                const purchase = await tx.purchase.create({
                    data: {
                        purchase_date: data.purchase_date,
                        warehouse_id: data.warehouse_id,
                        total_amount,
                        // Stored as "nothing paid yet": what was paid at creation is a Payment against an
                        // account (below), so the books and the cash position both see it.
                        paid_amount: new Prisma.Decimal(0),
                        due_amount: total_amount,
                        recorded_by_id: data.recorded_by_id,
                        ...(data.supplier_id !== undefined && { supplier_id: data.supplier_id }),
                        ...(data.invoice_no !== undefined && { invoice_no: data.invoice_no }),
                        ...(data.discount_type !== undefined &&
                            data.discount_value !== undefined && {
                                discount_type: data.discount_type,
                                discount_value: data.discount_value,
                            }),
                    },
                });

                for (const item of itemsWithTotals) {
                    const base_quantity = await toBaseQuantity(
                        tx,
                        item.item_id,
                        item.unit,
                        item.quantity,
                        "PURCHASE",
                    );
                    const purchaseItem = await tx.purchaseItem.create({
                        data: {
                            purchase_id: purchase.id,
                            item_id: item.item_id,
                            quantity: item.quantity,
                            unit: item.unit,
                            base_quantity,
                            unit_price: item.unit_price,
                            total_price: item.total_price,
                            ...(item.batch_id !== undefined && { batch_id: item.batch_id }),
                            ...(item.discount_type !== undefined &&
                                item.discount_value !== undefined && {
                                    discount_type: item.discount_type,
                                    discount_value: item.discount_value,
                                }),
                            ...(item.mfg_date !== undefined && { mfg_date: item.mfg_date }),
                            ...(item.expiration_date !== undefined && {
                                expiration_date: item.expiration_date,
                            }),
                        },
                    });
                    // A line bought for a batch (chicks) goes straight into that batch's house as live
                    // birds, tracked by BatchHouseBalance -- it never sits in the warehouse, so it posts
                    // no stock. Its cost still reaches the batch through PurchaseItem.batch_id.
                    if (item.batch_id !== undefined) continue;
                    await StockLedgerService.record(tx, {
                        item_id: item.item_id,
                        quantity: base_quantity,
                        direction: "IN",
                        reason: "PURCHASE",
                        ref_type: "PURCHASE",
                        ref_id: purchaseItem.id,
                        // Net line cost per base unit, not the raw unit_price -- base_quantity
                        // is in the item's base unit while unit_price is per purchase unit, and
                        // total_price is already net of the line's own discount.
                        unit_cost: item.total_price.dividedBy(base_quantity),
                        location_type: "WAREHOUSE",
                        location_id: data.warehouse_id,
                    });
                }

                await recordPaidAtCreate(tx, {
                    ref_type: "PURCHASE",
                    ref_id: purchase.id,
                    amount: paid_amount,
                    instrument_id: data.paid_from_instrument_id,
                    date: data.payment_date ?? data.purchase_date,
                    actor_id: data.recorded_by_id,
                    transaction_ref: data.payment_transaction_ref,
                    note: data.payment_note,
                });

                // Same transaction as the purchase: its charges can't go missing the way a separate
                // "related expense" call could.
                for (const charge of data.charges ?? []) {
                    await writeExpense(tx, {
                        ...charge,
                        cost_type: "STOCK",
                        purchase_id: purchase.id,
                        date: data.purchase_date,
                        recorded_by_id: data.recorded_by_id,
                    });
                }

                await audit(tx, {
                    table: "Purchase",
                    record_id: purchase.id,
                    action: "CREATE",
                    actor_id: data.recorded_by_id,
                    note: "Purchase recorded",
                    after: {
                        total_amount: total_amount.toString(),
                        paid_at_create: paid_amount.toString(),
                        lines: data.items.length,
                        ...(data.charges?.length && { charges: data.charges.length }),
                        ...(data.supplier_id !== undefined && { supplier_id: data.supplier_id }),
                        ...(data.invoice_no !== undefined && { invoice_no: data.invoice_no }),
                    },
                });

                return tx.purchase.findUniqueOrThrow({ where: { id: purchase.id }, include });
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    /** A charge that arrives after the purchase (the transport bill). Landed cost is computed on read,
     *  so stock this purchase already supplied is re-costed with it -- batch P&L stays real. */
    async addCharge(id: string, input: AddPurchaseChargeInput) {
        const purchase = await prisma.purchase.findUnique({
            where: { id },
            select: { is_opening: true, purchase_date: true },
        });
        if (!purchase) throw AppError.notFound("Purchase");
        if (purchase.is_opening) {
            throw AppError.badRequest(
                "An opening balance isn't a purchase -- it can't carry charges",
            );
        }
        checkExpensePaid(input);
        try {
            return await prisma.$transaction((tx) =>
                writeExpense(tx, {
                    ...input,
                    cost_type: "STOCK",
                    purchase_id: id,
                    date: input.date ?? new Date(),
                }),
            );
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    /** Removes a purchase entered by mistake, with everything it posted: its stock IN, its payments,
     *  its charges and their payments -- so every payable, cash and spend figure is right again with no
     *  reader knowing removal exists. The whole record goes to the audit log first; the user then
     *  re-enters the purchase correctly. Refused once something downstream depends on it: bound QR
     *  units, or warehouse stock already used or moved (removing it would drive the balance negative). */
    async remove(id: string, actor_id: string) {
        return prisma.$transaction(async (tx) => {
            const purchase = await tx.purchase.findUnique({
                where: { id },
                include: {
                    items: {
                        include: {
                            item: { select: { name: true } },
                            _count: { select: { stockUnits: true } },
                        },
                    },
                    charges: true,
                },
            });
            if (!purchase) throw AppError.notFound("Purchase");
            if (purchase.is_opening) {
                throw AppError.conflict("An opening balance isn't a purchase -- it can't be removed here");
            }
            const bound = purchase.items.reduce((n, l) => n + l._count.stockUnits, 0);
            if (bound > 0) {
                throw AppError.conflict(
                    `${bound} QR-coded unit${bound === 1 ? " is" : "s are"} bound to this purchase -- it can't be removed`,
                );
            }

            const ledger = await tx.stockLedger.findMany({
                where: { ref_type: "PURCHASE", ref_id: { in: purchase.items.map((l) => l.id) } },
            });
            const posted = new Map<string, Prisma.Decimal>();
            for (const e of ledger) {
                posted.set(e.item_id, (posted.get(e.item_id) ?? new Prisma.Decimal(0)).plus(e.quantity));
            }
            for (const [item_id, quantity] of posted) {
                const balance = await getItemLocationBalance(tx, item_id, "WAREHOUSE", purchase.warehouse_id);
                if (balance.lessThan(quantity)) {
                    const name = purchase.items.find((l) => l.item_id === item_id)?.item.name ?? "an item";
                    throw AppError.conflict(
                        `Some of the ${name} from this purchase has already been used or moved -- it can't be removed`,
                    );
                }
            }

            const chargeIds = purchase.charges.map((c) => c.id);
            const payments = await tx.payment.findMany({
                where: {
                    OR: [
                        { ref_type: "PURCHASE", ref_id: id },
                        { ref_type: "EXPENSE", ref_id: { in: chargeIds } },
                    ],
                },
            });

            await audit(tx, {
                table: "Purchase",
                record_id: id,
                action: "DELETE",
                actor_id,
                note: "Purchase removed (entered by mistake)",
                // Round-trip through JSON so Decimals and Dates land as plain strings.
                before: JSON.parse(JSON.stringify({ ...purchase, payments, stock_ledger: ledger })),
            });

            await tx.payment.deleteMany({ where: { id: { in: payments.map((p) => p.id) } } });
            await tx.stockLedger.deleteMany({ where: { id: { in: ledger.map((e) => e.id) } } });
            await tx.expense.deleteMany({ where: { id: { in: chargeIds } } });
            await tx.purchaseItem.deleteMany({ where: { purchase_id: id } });
            await tx.purchase.delete({ where: { id } });
        });
    },
};

export const PurchaseItemService = {
    async getAll(query: ListPurchaseItemsQuery) {
        const where = {
            ...(query.item_id !== undefined && { item_id: query.item_id }),
            ...(query.batch_id !== undefined && { batch_id: query.batch_id }),
        };
        const [purchaseItems, total] = await Promise.all([
            prisma.purchaseItem.findMany({
                where,
                include: { item: true, purchase: true, _count: { select: { stockUnits: true } } },
                orderBy: { created_at: "desc" },
                ...toSkipTake(query),
            }),
            prisma.purchaseItem.count({ where }),
        ]);

        // When each line was last linked (orders "recently completed"), and how many of its units
        // were linked since `since` (the field app's "linked today").
        const ids = purchaseItems.map((p) => p.id);
        const [latest, recent] = await Promise.all([
            prisma.stockUnit.groupBy({
                by: ["purchase_item_id"],
                where: { purchase_item_id: { in: ids } },
                _max: { bound_at: true },
            }),
            query.since
                ? prisma.stockUnit.groupBy({
                      by: ["purchase_item_id"],
                      where: { purchase_item_id: { in: ids }, bound_at: { gte: query.since } },
                      _count: { _all: true },
                  })
                : Promise.resolve([]),
        ]);
        const lastLinked = new Map(latest.map((r) => [r.purchase_item_id, r._max.bound_at]));
        const linkedSince = new Map(recent.map((r) => [r.purchase_item_id, r._count._all]));

        return {
            purchaseItems: purchaseItems.map((p) => ({
                ...p,
                last_linked_at: lastLinked.get(p.id) ?? null,
                linked_since: linkedSince.get(p.id) ?? 0,
            })),
            meta: buildMeta(total, query),
        };
    },

    /** Locks a lot whose bottle count was never saved (it predates splits): the caller states how many
     *  bottles it is, and that only sticks once every one of them has a code. A lot that already has a
     *  split completes by itself the moment its last code links, so there is nothing to mark. */
    async complete(id: string, unitCount: number) {
        return prisma.$transaction(async (tx) => {
            // Same per-lot lock bind() takes, so a scan can't land between the count and the write.
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
            const lot = await tx.purchaseItem.findUnique({
                where: { id },
                include: { item: true },
            });
            if (!lot) throw AppError.notFound("PurchaseItem");
            if (!lot.item.is_unit_tracked) {
                throw AppError.badRequest(`"${lot.item.name}" isn't tracked by QR code`);
            }
            if (lot.unit_count !== null) {
                throw AppError.conflict(
                    "This lot already has a bottle count — it completes when every code is linked",
                );
            }
            const linked = await tx.stockUnit.count({ where: { purchase_item_id: id } });
            if (linked < unitCount) {
                throw AppError.badRequest(
                    `Only ${linked} of ${unitCount} units are linked — link the rest first`,
                );
            }
            return tx.purchaseItem.update({
                where: { id },
                data: { unit_count: unitCount },
                include: { item: true, purchase: true, _count: { select: { stockUnits: true } } },
            });
        });
    },
};
