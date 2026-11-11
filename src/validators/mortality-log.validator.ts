import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

export const createMortalityLogSchema = z.object({
    batch_id: z.string().uuid(),
    house_id: z.string().uuid(),
    count_died: z.coerce.number().int().positive("Count died must be positive"),
    cause_note: z.string().optional(),
    disease_case_id: z.string().uuid().optional(),
    date: z.coerce.date(),
    idempotency_key: z.string().min(1).optional(),
});

/** Admin fix-up: link (or unlink) the outbreak a death was logged without. */
export const setMortalityDiseaseCaseSchema = z.object({
    disease_case_id: z.string().uuid().nullable(),
});

export const listMortalityLogsQuerySchema = paginationQuerySchema.extend({
    batch_id: z.string().uuid().optional(),
    house_id: z.string().uuid().optional(),
});

export type CreateMortalityLogInput = z.infer<typeof createMortalityLogSchema> & { recorded_by_id: string };
export type SetMortalityDiseaseCaseInput = z.infer<typeof setMortalityDiseaseCaseSchema>;
export type ListMortalityLogsQuery = z.infer<typeof listMortalityLogsQuerySchema>;
