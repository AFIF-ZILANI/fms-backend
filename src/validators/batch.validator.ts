import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

const birdBreed = z.enum(["CLASSIC", "HIBREED", "PAKISTHANI", "KEDERNATH", "FAOMI", "TIGER"]);
const batchStatus = z.enum(["RUNNING", "CLOSED", "SOLD"]);
const phase = z.enum(["BROODER", "GROWER"]);

export const createBatchSchema = z.object({
    batch_code: z.string().min(1, "Batch code is required"),
    breed: birdBreed,
    starting_date: z.coerce.date().optional(),
    expected_selling_date: z.coerce.date(),
    initial_chick_count: z.coerce.number().int().positive("Initial chick count must be positive"),
    init_chicks_avg_wt: z.coerce.number().positive("Initial average weight must be positive"),
    // Chicks are placed into a house the moment a batch exists -- creates the
    // matching INITIAL BatchHouseAllocation + BatchHouseBalance in one
    // transaction (system-design-arc.md's "chicks arrive" flow).
    house_id: z.string().uuid("A valid house id is required for initial placement"),
});

export const updateBatchSchema = z.object({
    batch_code: z.string().min(1).optional(),
    breed: birdBreed.optional(),
    phase: phase.optional(),
    expected_selling_date: z.coerce.date().optional(),
});

export const closeBatchSchema = z.object({
    status: z.enum(["CLOSED", "SOLD"]),
    force: z.boolean().optional(),
});

export const listBatchesQuerySchema = paginationQuerySchema.extend({
    status: batchStatus.optional(),
    breed: birdBreed.optional(),
    phase: phase.optional(),
});

export type CreateBatchInput = z.infer<typeof createBatchSchema> & { recorded_by_id: string };
export type UpdateBatchInput = z.infer<typeof updateBatchSchema>;
export type CloseBatchInput = z.infer<typeof closeBatchSchema>;
export type ListBatchesQuery = z.infer<typeof listBatchesQuerySchema>;
