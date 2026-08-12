import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

const houseType = z.enum(["BROODER", "GROWER", "LAYER"]);

export const createHouseSchema = z.object({
    name: z.string().min(1, "Name is required"),
    type: houseType,
    number: z.coerce.number().int().positive("Number must be positive"),
    capacity: z.coerce.number().int().positive().optional(),
});

export const updateHouseSchema = createHouseSchema.partial();

export const listHousesQuerySchema = paginationQuerySchema.extend({
    type: houseType.optional(),
    is_active: z.enum(["true", "false"]).optional(),
    // true = no batch currently occupying it (no BatchHouseBalance row with quantity > 0)
    is_available: z.enum(["true", "false"]).optional(),
});

export type CreateHouseInput = z.infer<typeof createHouseSchema>;
export type UpdateHouseInput = z.infer<typeof updateHouseSchema>;
export type ListHousesQuery = z.infer<typeof listHousesQuerySchema>;
