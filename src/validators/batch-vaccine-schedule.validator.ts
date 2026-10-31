import { z } from "zod";
import { vaccineEntrySchema } from "@validators/vaccine-template.validator";

const reason = z.string().trim().min(1, "Reason is required");

export const listBatchVaccineSchedulesQuerySchema = z.object({
    batch_id: z.string().uuid(),
});

export const applyVaccineTemplateSchema = z.object({
    batch_id: z.string().uuid(),
    template_id: z.string().uuid(),
});

export const createBatchVaccineScheduleSchema = vaccineEntrySchema.extend({
    batch_id: z.string().uuid(),
});

export const updateBatchVaccineScheduleSchema = vaccineEntrySchema.partial();

export const rescheduleVaccineSchema = z.object({
    day: z.coerce.number().int().min(1, "Day must be 1 or later"),
    reason,
});

export const cancelVaccineSchema = z.object({ reason });

export const confirmVaccineSchema = z.object({
    idempotency_key: z.string().min(1),
    // The house being vaccinated; every bottle must be in it. A batch in two houses confirms twice.
    house_id: z.string().uuid(),
    bottles: z
        // Just the codes: each bottle is used up, and the server knows what's left in it.
        .array(z.object({ stock_unit_id: z.string().uuid() }))
        .min(1, "Scan at least one bottle")
        .refine((b) => new Set(b.map((x) => x.stock_unit_id)).size === b.length, {
            message: "The same bottle was scanned twice",
        }),
});

export type ApplyVaccineTemplateInput = z.infer<typeof applyVaccineTemplateSchema>;
export type CreateBatchVaccineScheduleInput = z.infer<typeof createBatchVaccineScheduleSchema>;
export type UpdateBatchVaccineScheduleInput = z.infer<typeof updateBatchVaccineScheduleSchema>;
export type RescheduleVaccineInput = z.infer<typeof rescheduleVaccineSchema>;
export type CancelVaccineInput = z.infer<typeof cancelVaccineSchema>;
export type ConfirmVaccineInput = z.infer<typeof confirmVaccineSchema>;
