import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

const employeeRole = z.enum(["MANAGER", "WORKER", "INTERN"]);

export const createEmployeeSchema = z.object({
    name: z.string().min(1, "Name is required"),
    mobile: z.string().min(6, "Mobile is required"),
    email: z.string().email("Invalid email").optional(),
    address: z.string().optional(),
    role: employeeRole,
    salary: z.coerce.number().positive("Salary must be positive"),
    joining_date: z.coerce.date().optional(),
});

export const updateEmployeeSchema = createEmployeeSchema
    .omit({ joining_date: true })
    .partial()
    .extend({
        rating: z.coerce
            .number()
            .min(0, "Rating must be 0-5")
            .max(5, "Rating must be 0-5")
            .optional(),
    });

export const listEmployeesQuerySchema = paginationQuerySchema.extend({
    role: employeeRole.optional(),
    // kept as the raw "true"/"false" string -- see admin.validator.ts for why
    // (.transform() after .optional() breaks key-optionality under
    // exactOptionalPropertyTypes). Converted to boolean at the point of use.
    is_active: z.enum(["true", "false"]).optional(),
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
export type ListEmployeesQuery = z.infer<typeof listEmployeesQuerySchema>;
