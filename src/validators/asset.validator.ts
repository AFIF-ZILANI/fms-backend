import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

const assetStatus = z.enum(["ACTIVE", "RETIRED", "DISPOSED"]);

export const createAssetSchema = z.object({
    stock_unit_id: z.string().uuid(),
    name: z.string().min(1, "Name is required"),
    purchase_cost: z.coerce.number().positive("Purchase cost must be positive"),
    purchase_date: z.coerce.date(),
    useful_life_batches: z.coerce.number().int().positive("Useful life must be positive"),
});

export const updateAssetStatusSchema = z.object({
    status: assetStatus,
});

export const listAssetsQuerySchema = paginationQuerySchema.extend({
    status: assetStatus.optional(),
});

export type CreateAssetInput = z.infer<typeof createAssetSchema>;
export type UpdateAssetStatusInput = z.infer<typeof updateAssetStatusSchema>;
export type ListAssetsQuery = z.infer<typeof listAssetsQuerySchema>;
