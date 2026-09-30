import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

// Any code in EmployeeRole. Validity is enforced by the FK rather than a list
// here -- the whole point of the table is that the owner adds roles without a
// deploy. Same pattern as Expense.category.
const employeeRole = z.string().trim().min(1, "Role is required");
const maritalStatus = z.enum(["SINGLE", "MARRIED", "DIVORCED", "WIDOWED"]);
const employmentStatus = z.enum(["APPOINTED", "PROBATION", "CONFIRMED", "TERMINATED"]);

/**
 * Highest level completed. Stored as a plain String column so the list can grow
 * without a migration, but constrained here -- including the madrasah stream
 * (Dakhil, Alim), which is as common as SSC/HSC around the farm.
 */
export const EDUCATION_LEVELS = [
    "NONE",
    "PRIMARY",
    "JSC",
    "SSC",
    "DAKHIL",
    "HSC",
    "ALIM",
    "DIPLOMA",
    "BACHELOR",
    "MASTER",
] as const;
const education = z.enum(EDUCATION_LEVELS);

/**
 * E.164 for Bangladesh: +880 then a 10-digit mobile (01XXXXXXXXX without the
 * leading 0) or a 9-10 digit landline. The form supplies the +880 prefix, so a
 * value arriving without it is a client that skipped the component.
 */
const phone = z.string().regex(/^\+880\d{9,10}$/, "Must be a valid +880 number");

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
const employeeFields = {
    // identity
    name: z.string().min(1, "Name is required"),
    mobile: phone,
    email: z.string().email("Invalid email"),
    address: z.string().min(1, "Address is required"),
    date_of_birth: z.coerce.date({ message: "Date of birth is required" }),
    marital_status: maritalStatus,
    nid_number: z.string().min(1, "NID number is required"),
    avatar: avatarSchema,

    // employment
    role: employeeRole,
    // Omit it and the employee is paid their role's standard; a number here is
    // an override, audited as an exception. An explicit null clears an
    // existing override back to the standard -- the only way back through
    // that one-way door. z.null() has to come before z.coerce.number() in the
    // union: coerce turns a bare null into 0, which .positive() would then
    // (wrongly) reject as "not positive" instead of accepting it as a clear.
    reference_salary: z
        .union([z.null(), z.coerce.number().positive("Reference salary must be positive")])
        .optional(),
    joining_date: z.coerce.date().optional(),
    employment_status: employmentStatus.optional(),
    // Nullable, not merely optional: clearing the date has to be expressible,
    // and an omitted key on a PATCH means "leave unchanged".
    probation_end_date: z.coerce.date().nullable().optional(),

    // background
    education: education,
    experience_years: z.coerce.number().int().min(0, "Years can't be negative"),
    experience: z.string().min(1, "Describe the experience"),

    // emergency contact -- name, relationship and phone mandatory; the rest optional
    emergency_name: z.string().min(1, "Emergency contact name is required"),
    emergency_relation: z.string().min(1, "Emergency contact relationship is required"),
    emergency_phone: phone,
    emergency_email: z.string().email("Invalid email").optional(),
    emergency_address: z.string().optional(),

    // Reference -- optional, and either an employee or an outside person. These
    // are nullable, not merely optional: switching an existing employee's
    // reference from one kind to the other has to clear the other kind's fields,
    // and only an explicit null can say "erase this".
    reference_employee_id: z.string().uuid().nullable().optional(),
    reference_name: z.string().nullable().optional(),
    reference_phone: phone.nullable().optional(),
    reference_address: z.string().nullable().optional(),
};

/**
 * A reference is either one of our own employees or an outside person -- never
 * both, and an outside reference that has a name needs a phone to be reachable.
 */
type ReferenceFields = {
    reference_employee_id?: string | null | undefined;
    reference_name?: string | null | undefined;
    reference_phone?: string | null | undefined;
};

const notBothKinds = (d: ReferenceFields) =>
    !(d.reference_employee_id && (d.reference_name || d.reference_phone));

const outsideReferenceHasPhone = (d: ReferenceFields) => !d.reference_name || !!d.reference_phone;

const NOT_BOTH = {
    message: "A reference is either an employee or an outside contact, not both",
    path: ["reference_employee_id"],
};
const NEEDS_PHONE = {
    message: "Phone is required for an outside reference",
    path: ["reference_phone"],
};

export const createEmployeeSchema = z
    .object(employeeFields)
    .refine(notBothKinds, NOT_BOTH)
    .refine(outsideReferenceHasPhone, NEEDS_PHONE);

export const updateEmployeeSchema = z
    .object(employeeFields)
    .omit({ joining_date: true })
    .partial()
    .extend({
        rating: z.coerce
            .number()
            .min(0, "Rating must be 0-5")
            .max(5, "Rating must be 0-5")
            .optional(),
    })
    .refine(notBothKinds, NOT_BOTH)
    .refine(outsideReferenceHasPhone, NEEDS_PHONE);

export const listEmployeesQuerySchema = paginationQuerySchema.extend({
    role: employeeRole.optional(),
    // Name or mobile. Needed server-side once the list is paginated -- filtering
    // in memory would only ever search the page you happen to be looking at.
    q: z.string().trim().min(1).optional(),
    employment_status: employmentStatus.optional(),
    // kept as the raw "true"/"false" string -- see admin.validator.ts for why
    // (.transform() after .optional() breaks key-optionality under
    // exactOptionalPropertyTypes). Converted to boolean at the point of use.
    is_active: z.enum(["true", "false"]).optional(),
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
// actor_id is stamped by the controller from getActorId(c), never accepted from
// the body -- a client that can name the actor could forge attribution on the
// audit row a salary-override change writes.
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema> & {
    actor_id?: string;
};
export type ListEmployeesQuery = z.infer<typeof listEmployeesQuerySchema>;
