import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

export const listAssetDepreciationsQuerySchema = paginationQuerySchema.extend({
    asset_id: z.string().uuid().optional(),
    batch_id: z.string().uuid().optional(),
});

export type ListAssetDepreciationsQuery = z.infer<typeof listAssetDepreciationsQuerySchema>;
