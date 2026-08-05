import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

export const createWarehouseSchema = z.object({
    name: z.string().min(1, "Name is required"),
});

export const updateWarehouseSchema = createWarehouseSchema.partial();

export const listWarehousesQuerySchema = paginationQuerySchema;

export type CreateWarehouseInput = z.infer<typeof createWarehouseSchema>;
export type UpdateWarehouseInput = z.infer<typeof updateWarehouseSchema>;
export type ListWarehousesQuery = z.infer<typeof listWarehousesQuerySchema>;
