import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

export const createCustomerSchema = z.object({
    name: z.string().min(1, "Name is required"),
    mobile: z.string().min(6, "Mobile is required"),
    email: z.string().email("Invalid email").optional(),
    address: z.string().optional(),
    company: z.string().optional(),
});

export const updateCustomerSchema = createCustomerSchema.partial().extend({
    rating: z.coerce.number().min(0, "Rating must be 0-5").max(5, "Rating must be 0-5").optional(),
});

export const listCustomersQuerySchema = paginationQuerySchema.extend({
    is_active: z.enum(["true", "false"]).optional(),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;
