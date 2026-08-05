import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

export const createWeightRecordSchema = z.object({
    batch_id: z.string().uuid().optional(),
    house_id: z.string().uuid(),
    average_wt_grams: z.coerce.number().positive("Average weight must be positive"),
    sample_size: z.coerce.number().int().positive("Sample size must be positive"),
    date: z.coerce.date(),
    measured_by_id: z.string().uuid(),
    idempotency_key: z.string().min(1).optional(),
});

export const listWeightRecordsQuerySchema = paginationQuerySchema.extend({
    batch_id: z.string().uuid().optional(),
    house_id: z.string().uuid().optional(),
});

export type CreateWeightRecordInput = z.infer<typeof createWeightRecordSchema>;
export type ListWeightRecordsQuery = z.infer<typeof listWeightRecordsQuerySchema>;
