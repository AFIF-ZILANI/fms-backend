import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

export const createDoctorSchema = z.object({
    name: z.string().min(1, "Name is required"),
    mobile: z.string().min(6, "Mobile is required"),
    email: z.string().email("Invalid email").optional(),
    address: z.string().optional(),
    specialty: z.string().optional(),
    position: z.string().optional(),
    degrees: z.array(z.string()).optional(),
    institution: z.string().optional(),
});

export const updateDoctorSchema = createDoctorSchema.partial();

export const listDoctorsQuerySchema = paginationQuerySchema.extend({
    is_active: z.enum(["true", "false"]).optional(),
});

export type CreateDoctorInput = z.infer<typeof createDoctorSchema>;
export type UpdateDoctorInput = z.infer<typeof updateDoctorSchema>;
export type ListDoctorsQuery = z.infer<typeof listDoctorsQuerySchema>;
