import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";
import { unitSchema, resourceCategorySchema } from "@lib/enums";

const saleItemInput = z.object({
    item_id: z.string().uuid(),
    quantity: z.coerce.number().positive("Quantity must be positive"),
    // Omitted on QR (CODED) lines: their quantity is a count of bottles, each carrying its own size.
    unit: unitSchema.optional(),
    unit_price: z.coerce.number().positive("Unit price must be positive"),
});

export const saleKindSchema = z.enum(["CODED", "STOCK", "FARM_MADE"]);

export const createSaleSchema = z.object({
    // One kind per sale: QR bottles (scanned out later on mobile), bought stock, or farm-made.
    // Defaults to STOCK so a client from before kinds (an old web bundle) still records stock sales; anything
    // else it sends is then refused by the kind check rather than mis-recorded.
    kind: saleKindSchema.default("STOCK"),
    // Optional: the batch whose books this sale belongs to (litter after the flock is sold).
    batch_id: z.string().uuid().optional(),
    customer_id: z.string().uuid().optional(),
    sale_date: z.coerce.date(),
    // STOCK sales only: stock leaves this warehouse; the sale is refused if it holds less than is being sold.
    warehouse_id: z.string().uuid().optional(),
    paid_amount: z.coerce.number().nonnegative().default(0),
    // Required when paid_amount > 0: which of the farm's accounts the money went into.
    paid_to_instrument_id: z.string().uuid().optional(),
    items: z.array(saleItemInput).min(1, "At least one item is required"),
});

export const salesSummaryQuerySchema = z.object({
    customer_id: z.string().uuid().optional(),
    date_from: z.coerce.date().optional(),
    date_to: z.coerce.date().optional(),
    item_category: resourceCategorySchema.optional(),
    kind: saleKindSchema.optional(),
});

/** What the Record sale form can offer: sealed bottles per QR item, or one warehouse's balance per stock item. */
export const sellableQuerySchema = z
    .object({ kind: z.enum(["CODED", "STOCK"]), warehouse_id: z.string().uuid().optional() })
    .refine((q) => q.kind !== "STOCK" || q.warehouse_id !== undefined, {
        message: "warehouse_id is required for bought stock",
        path: ["warehouse_id"],
    });

// Extended from the summary shape so the two filter sets can never drift.
export const listSalesQuerySchema = paginationQuerySchema.extend(salesSummaryQuerySchema.shape);

export type CreateSaleInput = z.infer<typeof createSaleSchema> & { recorded_by_id: string };
export type ListSalesQuery = z.infer<typeof listSalesQuerySchema>;
export type SalesSummaryQuery = z.infer<typeof salesSummaryQuerySchema>;
export type SellableQuery = z.infer<typeof sellableQuerySchema>;
