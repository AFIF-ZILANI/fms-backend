import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

const supplierRole = z.enum([
    "SALES_MAN",
    "OWNER",
    "DISTRIBUTOR",
    "DEALER",
    "WHOLESALER",
    "RETAILER",
    "MANUFACTURER",
    "IMPORTER",
    "REPRESENTATIVE",
]);

const supplyCategory = z.enum([
    "FEED",
    "MEDICINE",
    "CHICKS",
    "HUSK",
    "EQUIPMENT",
    "UTILITIES",
    "TRANSPORTATION",
    "CLEANING_SUPPLIES",
    "OFFICE_SUPPLIES",
    "SOFTWARE",
    "OTHER",
]);

export const createSupplierSchema = z.object({
    name: z.string().min(1, "Name is required"),
    mobile: z.string().min(6, "Mobile is required"),
    email: z.string().email("Invalid email").optional(),
    address: z.string().optional(),
    role: supplierRole,
    supplies: z.array(supplyCategory).min(1, "At least one supply category is required"),
    company: z.string().optional(),
});

export const updateSupplierSchema = createSupplierSchema.partial();

export const listSuppliersQuerySchema = paginationQuerySchema.extend({
    role: supplierRole.optional(),
    supplies: supplyCategory.optional(),
    // kept as a raw string -- see admin.validator.ts for why this isn't
    // .transform()'d to boolean in the schema.
    is_active: z.enum(["true", "false"]).optional(),
});

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
export type ListSuppliersQuery = z.infer<typeof listSuppliersQuerySchema>;
