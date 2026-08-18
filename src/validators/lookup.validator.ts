import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

export const createLookupSchema = z.object({
    label: z.string().trim().min(1, "Label is required"),
});

export const updateLookupSchema = createLookupSchema;

export const listLookupQuerySchema = paginationQuerySchema.extend({
    active: z.enum(["true", "false"]).optional(),
});

export type CreateLookupInput = z.infer<typeof createLookupSchema>;
export type UpdateLookupInput = z.infer<typeof updateLookupSchema>;
export type ListLookupQuery = z.infer<typeof listLookupQuerySchema>;
