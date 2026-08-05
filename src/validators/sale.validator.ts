import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";
import { unitSchema } from "@lib/enums";

const saleItemInput = z.object({
    item_id: z.string().uuid(),
    quantity: z.coerce.number().positive("Quantity must be positive"),
    unit: unitSchema,
    unit_price: z.coerce.number().positive("Unit price must be positive"),
});

export const createSaleSchema = z.object({
    customer_id: z.string().uuid().optional(),
    sale_date: z.coerce.date(),
    paid_amount: z.coerce.number().nonnegative().default(0),
    recorded_by_id: z.string().uuid(),
    items: z.array(saleItemInput).min(1, "At least one item is required"),
});

export const listSalesQuerySchema = paginationQuerySchema.extend({
    customer_id: z.string().uuid().optional(),
});

export type CreateSaleInput = z.infer<typeof createSaleSchema>;
export type ListSalesQuery = z.infer<typeof listSalesQuerySchema>;
