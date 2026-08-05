import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

const criterion = z.enum([
    "ATTENDANCE_PERFECT",
    "EARLY_PROBLEM_REPORT",
    "SUGGESTION_IMPLEMENTED",
    "ZERO_NEGLIGENT_LOSS",
    "ACCURATE_DATA_ENTRY",
    "BIOSECURITY_FOLLOWED",
    "HELPED_COWORKER",
    "EXTRA_TASK_COMPLETED",
    "TEAM_TARGET_HIT",
    "CONFLICT_RESOLVED",
    "FALSIFIED_RECORD",
    "NEGLIGENT_LOSS",
    "BIOSECURITY_VIOLATION",
    "CONCEALED_PROBLEM",
    "MISSED_CRITICAL_TASK",
    "EQUIPMENT_DAMAGE",
    "CONDUCT_ISSUE",
    "TEAM_SUPERVISION_FAILURE",
    "UNEXCUSED_ABSENCE",
    "PATTERN_LATENESS",
    "OTHER",
]);

export const createScoreEntrySchema = z
    .object({
        employee_id: z.string().uuid(),
        given_by_id: z.string().uuid(),
        criterion,
        // Only used (and required) when criterion === "OTHER" -- every
        // fixed criterion's points come from FIXED_CRITERION_POINTS, never
        // the client.
        points: z.coerce.number().int().optional(),
        reason: z.string().min(1, "Reason is required"),
        date: z.coerce.date().optional(),
        idempotency_key: z.string().min(1).optional(),
    })
    .refine(
        (data) =>
            data.criterion !== "OTHER" ||
            (data.points !== undefined && data.points !== 0 && Math.abs(data.points) <= 5),
        { message: "OTHER requires points between -5 and 5, excluding 0" },
    );

export const listScoreEntriesQuerySchema = paginationQuerySchema.extend({
    employee_id: z.string().uuid().optional(),
});

export type CreateScoreEntryInput = z.infer<typeof createScoreEntrySchema>;
export type ListScoreEntriesQuery = z.infer<typeof listScoreEntriesQuerySchema>;
