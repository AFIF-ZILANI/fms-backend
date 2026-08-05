import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

export const createAdminSchema = z.object({
    name: z.string().min(1, "Name is required"),
    mobile: z.string().min(6, "Mobile is required"),
    email: z.string().email("Invalid email").optional(),
    address: z.string().optional(),
});

export const updateAdminSchema = createAdminSchema.partial();

export const listAdminsQuerySchema = paginationQuerySchema.extend({
    // kept as the raw "true"/"false" string here (not transformed to boolean)
    // -- chaining .transform() after .optional() makes the output key
    // required-with-undefined instead of truly optional under
    // exactOptionalPropertyTypes. Converted to boolean at the point of use.
    is_active: z.enum(["true", "false"]).optional(),
});

export type CreateAdminInput = z.infer<typeof createAdminSchema>;
export type UpdateAdminInput = z.infer<typeof updateAdminSchema>;
export type ListAdminsQuery = z.infer<typeof listAdminsQuerySchema>;
