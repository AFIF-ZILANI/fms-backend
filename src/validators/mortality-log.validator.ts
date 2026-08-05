import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

export const createMortalityLogSchema = z.object({
    batch_id: z.string().uuid(),
    house_id: z.string().uuid(),
    count_died: z.coerce.number().int().positive("Count died must be positive"),
    cause_note: z.string().optional(),
    date: z.coerce.date(),
    recorded_by_id: z.string().uuid(),
    idempotency_key: z.string().min(1).optional(),
});

export const listMortalityLogsQuerySchema = paginationQuerySchema.extend({
    batch_id: z.string().uuid().optional(),
    house_id: z.string().uuid().optional(),
});

export type CreateMortalityLogInput = z.infer<typeof createMortalityLogSchema>;
export type ListMortalityLogsQuery = z.infer<typeof listMortalityLogsQuerySchema>;
