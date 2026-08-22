import prisma from "@lib/db";
import { Prisma } from "../../prisma/generated/prisma/client";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import { toBaseQuantity } from "@lib/unit-conversion";
import { StockLedgerService } from "@services/stock-ledger.service";
import type {
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
        const purchase = await prisma.purchase.findUnique({ where: { id }, include });
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
            const discount = computeDiscount(gross, item.discount_type, item.discount_value, "Line");
            return { ...item, total_price: gross.minus(discount) };
        });
        const subtotal = itemsWithTotals.reduce(
            (sum, item) => sum.plus(item.total_price),
            new Prisma.Decimal(0),
        );
        const globalDiscount = computeDiscount(subtotal, data.discount_type, data.discount_value, "Purchase");
        const total_amount = subtotal.minus(globalDiscount);
        const paid_amount = new Prisma.Decimal(data.paid_amount);
        const due_amount = total_amount.minus(paid_amount);
        if (due_amount.isNegative()) {
            throw AppError.badRequest("paid_amount cannot exceed the purchase total");
        }

        try {
            return await prisma.$transaction(async (tx) => {
                const purchase = await tx.purchase.create({
                    data: {
                        purchase_date: data.purchase_date,
                        total_amount,
                        paid_amount,
                        due_amount,
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
                    await StockLedgerService.record(tx, {
                        item_id: item.item_id,
                        quantity: base_quantity,
                        direction: "IN",
                        reason: "PURCHASE",
                        ref_type: "PURCHASE",
                        ref_id: purchaseItem.id,
                    });
                }

                return tx.purchase.findUniqueOrThrow({ where: { id: purchase.id }, include });
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
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
                include: { item: true, purchase: true },
                orderBy: { created_at: "desc" },
                ...toSkipTake(query),
            }),
            prisma.purchaseItem.count({ where }),
        ]);
        return { purchaseItems, meta: buildMeta(total, query) };
    },
};
