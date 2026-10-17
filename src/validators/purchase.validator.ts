import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";
import { unitSchema, resourceCategorySchema } from "@lib/enums";

export const discountTypeSchema = z.enum(["FLAT", "PERCENT"]);

// discount_type and discount_value travel together -- a lone type with no value (or vice versa)
// is ambiguous, so both-or-neither is enforced here rather than left to the service layer.
const discountFields = {
    discount_type: discountTypeSchema.optional(),
    discount_value: z.coerce.number().nonnegative().optional(),
};
const discountRefine = <
    T extends {
        discount_type?: "FLAT" | "PERCENT" | undefined;
        discount_value?: number | undefined;
    },
>(
    data: T,
) => (data.discount_type === undefined) === (data.discount_value === undefined);
const discountRefineMessage = {
    message: "discount_type and discount_value must be given together",
    path: ["discount_value"],
};

const purchaseItemInput = z
    .object({
        item_id: z.string().uuid(),
        batch_id: z.string().uuid().optional(),
        quantity: z.coerce.number().positive("Quantity must be positive"),
        unit: unitSchema,
        unit_price: z.coerce.number().positive("Unit price must be positive"),
        ...discountFields,
        mfg_date: z.coerce.date().optional(),
        expiration_date: z.coerce.date().optional(),
    })
    .refine(discountRefine, discountRefineMessage);

export const createPurchaseSchema = z
    .object({
        supplier_id: z.string().uuid().optional(),
        warehouse_id: z.string().uuid(),
        invoice_no: z.string().optional(),
        purchase_date: z.coerce.date(),
        paid_amount: z.coerce.number().nonnegative().default(0),
        // Required when paid_amount > 0: which of the farm's accounts the money came from.
        paid_from_instrument_id: z.string().uuid().optional(),
        // Details of the payment made at creation; it defaults to the purchase date.
        payment_date: z.coerce.date().optional(),
        payment_transaction_ref: z.string().trim().min(1).optional(),
        payment_note: z.string().trim().min(1).optional(),
        ...discountFields,
        items: z.array(purchaseItemInput).min(1, "At least one item is required"),
    })
    .refine(discountRefine, discountRefineMessage);

export const listPurchasesQuerySchema = paginationQuerySchema.extend({
    supplier_id: z.string().uuid().optional(),
    date_from: z.coerce.date().optional(),
    date_to: z.coerce.date().optional(),
    item_category: resourceCategorySchema.optional(),
});

export const listPurchaseItemsQuerySchema = paginationQuerySchema.extend({
    item_id: z.string().uuid().optional(),
    batch_id: z.string().uuid().optional(),
    // Start of the caller's day: each line then reports how many of its units were linked since.
    since: z.coerce.date().optional(),
});

export const completePurchaseItemSchema = z.object({
    unit_count: z.number().int().min(1).max(10000),
});

export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema> & { recorded_by_id: string };
export type ListPurchasesQuery = z.infer<typeof listPurchasesQuerySchema>;
export type ListPurchaseItemsQuery = z.infer<typeof listPurchaseItemsQuerySchema>;
export type CompletePurchaseItemInput = z.infer<typeof completePurchaseItemSchema>;
