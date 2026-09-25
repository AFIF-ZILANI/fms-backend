import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

const employeeRole = z.enum(["MANAGER", "WORKER", "INTERN"]);
const maritalStatus = z.enum(["SINGLE", "MARRIED", "DIVORCED", "WIDOWED"]);
const employmentStatus = z.enum(["APPOINTED", "PROBATION", "CONFIRMED", "TERMINATED"]);

/** What the browser gets back from a direct-to-Cloudinary upload. */
const avatarSchema = z.object({
    public_id: z.string().min(1),
    image_url: z.string().url(),
});

/**
 * The fields docs/employee_hire.md marks Mandatory are required here even though
 * their columns are nullable -- the columns stay nullable for rows that predate
 * the hire-profile migration, but no new hire may skip them.
 */
export const createEmployeeSchema = z.object({
    // identity
    name: z.string().min(1, "Name is required"),
    mobile: z.string().min(6, "Mobile is required"),
    email: z.string().email("Invalid email").optional(),
    address: z.string().min(1, "Address is required"),
    date_of_birth: z.coerce.date({ message: "Date of birth is required" }),
    marital_status: maritalStatus,
    nid_number: z.string().min(1, "NID number is required"),
    avatar: avatarSchema,

    // employment
    role: employeeRole,
    salary: z.coerce.number().positive("Salary must be positive"),
    joining_date: z.coerce.date().optional(),
    employment_status: employmentStatus.optional(),
    probation_end_date: z.coerce.date().optional(),

    // background
    education: z.string().min(1, "Educational background is required"),
    experience: z.string().min(1, "Experience is required"),

    // emergency contact -- mandatory
    emergency_name: z.string().min(1, "Emergency contact name is required"),
    emergency_relation: z.string().min(1, "Emergency contact relationship is required"),
    emergency_phone: z.string().min(6, "Emergency contact phone is required"),

    // reference -- recommended, not required
    reference_name: z.string().optional(),
    reference_relation: z.string().optional(),
    reference_phone: z.string().optional(),
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
    employment_status: employmentStatus.optional(),
    // kept as the raw "true"/"false" string -- see admin.validator.ts for why
    // (.transform() after .optional() breaks key-optionality under
    // exactOptionalPropertyTypes). Converted to boolean at the point of use.
    is_active: z.enum(["true", "false"]).optional(),
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
export type ListEmployeesQuery = z.infer<typeof listEmployeesQuerySchema>;
