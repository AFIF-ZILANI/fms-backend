import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

export const createVaccinationSchema = z.object({
    batch_id: z.string().uuid(),
    consumption_id: z.string().uuid().optional(),
    vaccine_name: z.string().min(1, "Vaccine name is required"),
    dosage: z.coerce.number().int().positive("Dosage must be positive"),
    cause: z.string().optional(),
    period: z.string().optional(),
    administered_by_id: z.string().uuid(),
    doctor_id: z.string().uuid().optional(),
    remarks: z.string().optional(),
    date: z.coerce.date().optional(),
    idempotency_key: z.string().min(1).optional(),
});

export const listVaccinationsQuerySchema = paginationQuerySchema.extend({
    batch_id: z.string().uuid().optional(),
});

export type CreateVaccinationInput = z.infer<typeof createVaccinationSchema>;
export type ListVaccinationsQuery = z.infer<typeof listVaccinationsQuerySchema>;
