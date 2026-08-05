import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

export const listBalancesQuerySchema = paginationQuerySchema.extend({
    batch_id: z.string().uuid().optional(),
    house_id: z.string().uuid().optional(),
});

export type ListBalancesQuery = z.infer<typeof listBalancesQuerySchema>;
