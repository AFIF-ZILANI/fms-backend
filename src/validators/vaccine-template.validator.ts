import { z } from "zod";

const optionalText = z.string().trim().min(1).optional();

export const VACCINE_METHODS = [
    "EYE_DROP",
    "NASAL_DROP",
    "DRINKING_WATER",
    "MUSCLE_INJECTION",
    "NECK_INJECTION",
    "SPRAY",
] as const;

export const vaccineEntrySchema = z.object({
    day: z.coerce.number().int().min(1, "Day must be 1 or later"),
    // A VaccinePurpose code; the foreign key rejects an unknown one.
    purpose: z.string().trim().min(1, "Purpose is required"),
    method: z.enum(VACCINE_METHODS).optional(),
    note: optionalText,
});

export const createVaccineTemplateSchema = z.object({
    name: z.string().trim().min(1, "Name is required"),
    entries: z.array(vaccineEntrySchema).default([]),
});

export const updateVaccineTemplateSchema = z.object({
    name: z.string().trim().min(1, "Name is required").optional(),
    is_active: z.boolean().optional(),
    // Replaces every row; the template editor always sends the whole list.
    entries: z.array(vaccineEntrySchema).optional(),
});

export const listVaccineTemplatesQuerySchema = z.object({
    active: z.enum(["true", "false"]).optional(),
});

export type VaccineEntryInput = z.infer<typeof vaccineEntrySchema>;
export type CreateVaccineTemplateInput = z.infer<typeof createVaccineTemplateSchema>;
export type UpdateVaccineTemplateInput = z.infer<typeof updateVaccineTemplateSchema>;
export type ListVaccineTemplatesQuery = z.infer<typeof listVaccineTemplatesQuerySchema>;
