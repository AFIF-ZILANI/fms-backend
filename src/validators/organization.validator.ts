import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

export const createOrganizationSchema = z.object({
    label_name: z.string().min(1, "Label is required"),
});

export const updateOrganizationSchema = createOrganizationSchema.partial();

export const listOrganizationsQuerySchema = paginationQuerySchema;

export const createItemOrganizationSchema = z.object({
    item_id: z.string().uuid(),
    organization_id: z.string().uuid(),
    role: z.enum(["MANUFACTURER", "IMPORTER", "MARKETER", "DISTRIBUTOR"]),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
export type ListOrganizationsQuery = z.infer<typeof listOrganizationsQuerySchema>;
export type CreateItemOrganizationInput = z.infer<typeof createItemOrganizationSchema>;
