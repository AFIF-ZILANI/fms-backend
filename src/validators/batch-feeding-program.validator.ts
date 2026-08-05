import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

const feedType = z.enum(["PRE_STARTER", "STARTER", "GROWER", "FINISHER", "LAYER"]);

export const createFeedingProgramSchema = z.object({
    batch_id: z.string().uuid(),
    feed_type: feedType,
    item_id: z.string().uuid(),
    start_day: z.coerce.number().int().nonnegative(),
    end_day: z.coerce.number().int().nonnegative().optional(),
});

export const updateFeedingProgramSchema = z.object({
    end_day: z.coerce.number().int().nonnegative(),
});

export const listFeedingProgramsQuerySchema = paginationQuerySchema.extend({
    batch_id: z.string().uuid().optional(),
});

export type CreateFeedingProgramInput = z.infer<typeof createFeedingProgramSchema>;
export type UpdateFeedingProgramInput = z.infer<typeof updateFeedingProgramSchema>;
export type ListFeedingProgramsQuery = z.infer<typeof listFeedingProgramsQuerySchema>;
