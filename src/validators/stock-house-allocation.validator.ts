import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

export const listStockHouseAllocationsQuerySchema = paginationQuerySchema.extend({
    house_id: z.string().uuid().optional(),
    type: z.enum(["ALLOCATION", "REALLOCATION", "RETURN"]).optional(),
    stock_unit_id: z.string().optional(),
});

export type ListStockHouseAllocationsQuery = z.infer<typeof listStockHouseAllocationsQuerySchema>;
