import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

const feedType = z.enum(["PRE_STARTER", "STARTER", "GROWER", "FINISHER", "LAYER"]);

export const createFeedingProgramSchema = z.object({
    batch_id: z.string().uuid(),
    feed_type: feedType,
    item_id: z.string().uuid(),
    // Day 1 is the placement day.
    start_day: z.coerce.number().int().positive(),
    end_day: z.coerce.number().int().positive().optional(),
    idempotency_key: z.string().min(1).optional(),
});

export const updateFeedingProgramSchema = z.object({
    end_day: z.coerce.number().int().positive(),
});

export const listFeedingProgramsQuerySchema = paginationQuerySchema.extend({
    batch_id: z.string().uuid().optional(),
});

export type CreateFeedingProgramInput = z.infer<typeof createFeedingProgramSchema>;
export type UpdateFeedingProgramInput = z.infer<typeof updateFeedingProgramSchema>;
export type ListFeedingProgramsQuery = z.infer<typeof listFeedingProgramsQuerySchema>;
