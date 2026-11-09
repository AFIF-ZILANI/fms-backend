import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

const SEVERITIES = ["LOW", "MEDIUM", "HIGH"] as const;
const DIAGNOSIS_METHODS = ["FIELD", "POST_MORTEM", "LAB"] as const;
const OUTCOMES = ["RECOVERED", "CULLED", "SOLD_EARLY"] as const;

const caseFields = {
    disease_id: z.string().uuid(),
    house_ids: z.array(z.string().uuid()).min(1, "Pick at least one house"),
    severity: z.enum(SEVERITIES),
    symptoms: z.array(z.string().trim().min(1)).max(30).optional(),
    affected_count: z.number().int().positive().nullable().optional(),
    diagnosis_method: z.enum(DIAGNOSIS_METHODS),
    doctor_id: z.string().uuid().nullable().optional(),
    noticed_on: z.coerce.date(),
    notes: z.string().trim().nullable().optional(),
};

export const createDiseaseCaseSchema = z.object({ batch_id: z.string().uuid(), ...caseFields });

/** Any field can be edited. status RESOLVED needs the day it ended and how; ACTIVE reopens it. */
export const updateDiseaseCaseSchema = z
    .object({
        ...caseFields,
        status: z.enum(["ACTIVE", "RESOLVED"]),
        resolved_on: z.coerce.date().nullable(),
        outcome: z.enum(OUTCOMES).nullable(),
    })
    .partial()
    .refine((d) => d.status !== "RESOLVED" || (d.resolved_on && d.outcome), {
        message: "Resolving a case needs a resolved date and an outcome",
        path: ["outcome"],
    });

export const listDiseaseCasesQuerySchema = paginationQuerySchema.extend({
    batch_id: z.string().uuid().optional(),
    status: z.enum(["ACTIVE", "RESOLVED"]).optional(),
});

export type CreateDiseaseCaseInput = z.infer<typeof createDiseaseCaseSchema> & {
    recorded_by_id: string;
};
export type UpdateDiseaseCaseInput = z.infer<typeof updateDiseaseCaseSchema>;
export type ListDiseaseCasesQuery = z.infer<typeof listDiseaseCasesQuerySchema>;
