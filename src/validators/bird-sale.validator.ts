import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

export const createBirdSaleSchema = z
    .object({
        batch_id: z.string().uuid(),
        house_id: z.string().uuid(),
        customer_id: z.string().uuid().optional(),
        sale_date: z.coerce.date(),
        grade: z.enum(["HIGH", "LOW", "CULL"]),
        male_count: z.coerce.number().int().nonnegative().optional(),
        female_count: z.coerce.number().int().nonnegative().optional(),
        birds_count: z.coerce.number().int().positive("Bird count must be positive"),
        // Regional fields (dholta/katha) kept exactly as-is, not derived --
        // see full-schema-analysis.md: don't touch business meaning we
        // don't have full context on.
        dholta_in_g: z.coerce.number().nonnegative(),
        total_katha: z.coerce.number().int().nonnegative(),
        avg_wt_per_katha_kg: z.coerce.number().positive().optional(),
        total_weight: z.coerce.number().positive("Total weight must be positive"),
        net_weight: z.coerce.number().positive("Net weight must be positive"),
        avg_weight_g: z.coerce.number().positive().optional(),
        price_per_kg: z.coerce.number().positive("Price per kg must be positive"),
        paid_amount: z.coerce.number().nonnegative().default(0),
        recorded_by_id: z.string().uuid(),
    })
    .refine(
        (data) =>
            data.male_count === undefined ||
            data.female_count === undefined ||
            data.male_count + data.female_count === data.birds_count,
        { message: "male_count + female_count must equal birds_count when both are given" },
    );

export const listBirdSalesQuerySchema = paginationQuerySchema.extend({
    batch_id: z.string().uuid().optional(),
    customer_id: z.string().uuid().optional(),
});

export type CreateBirdSaleInput = z.infer<typeof createBirdSaleSchema>;
export type ListBirdSalesQuery = z.infer<typeof listBirdSalesQuerySchema>;
