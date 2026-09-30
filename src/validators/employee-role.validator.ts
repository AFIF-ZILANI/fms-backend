import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

// `code` is never client-supplied -- it is derived from the label, once, at
// create. Same rule as every other lookup in this codebase.
export const createEmployeeRoleSchema = z.object({
    label: z.string().trim().min(1, "Label is required"),
    reference_salary: z.coerce.number().positive("Reference salary must be positive"),
});

export const updateEmployeeRoleSchema = createEmployeeRoleSchema;

export const listEmployeeRolesQuerySchema = paginationQuerySchema.extend({
    active: z.enum(["true", "false"]).optional(),
});

export type CreateEmployeeRoleInput = z.infer<typeof createEmployeeRoleSchema>;
export type UpdateEmployeeRoleInput = z.infer<typeof updateEmployeeRoleSchema>;
export type ListEmployeeRolesQuery = z.infer<typeof listEmployeeRolesQuerySchema>;
