import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

export const createMedicationSchema = z.object({
    batch_id: z.string().uuid(),
    consumption_id: z.string().uuid().optional(),
    medicine_name: z.string().min(1, "Medicine name is required"),
    dosage: z.string().min(1, "Dosage is required"),
    cause: z.string().optional(),
    period: z.string().optional(),
    administered_by_id: z.string().uuid(),
    doctor_id: z.string().uuid().optional(),
    remarks: z.string().optional(),
    date: z.coerce.date().optional(),
    idempotency_key: z.string().min(1).optional(),
});

export const listMedicationsQuerySchema = paginationQuerySchema.extend({
    batch_id: z.string().uuid().optional(),
});

export type CreateMedicationInput = z.infer<typeof createMedicationSchema>;
export type ListMedicationsQuery = z.infer<typeof listMedicationsQuerySchema>;
