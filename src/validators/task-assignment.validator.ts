import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

const taskStatus = z.enum(["PENDING", "DONE", "CANCELLED"]);

export const createTaskAssignmentSchema = z
    .object({
        employee_id: z.string().uuid(),
        task_id: z.string().uuid(),
        title: z.string().trim().min(1, "Title is required"),
        description: z.string().optional(),
        // Location is a house OR a free-text note, never both -- refined below.
        house_id: z.string().uuid().optional(),
        location_note: z.string().trim().min(1).optional(),
        due_at: z.coerce.date(),
        idempotency_key: z.string().min(1).optional(),
    })
    .refine((data) => !(data.house_id !== undefined && data.location_note !== undefined), {
        message: "Provide either house_id or location_note, not both",
        path: ["location_note"],
    });

export const updateTaskAssignmentSchema = z
    .object({
        title: z.string().trim().min(1).optional(),
        description: z.string().optional(),
        house_id: z.string().uuid().nullable().optional(),
        location_note: z.string().trim().min(1).nullable().optional(),
        due_at: z.coerce.date().optional(),
    })
    .refine((data) => !(data.house_id && data.location_note), {
        message: "Provide either house_id or location_note, not both",
        path: ["location_note"],
    });

export const completeTaskAssignmentSchema = z.object({
    completion_note: z.string().optional(),
});

export const listTaskAssignmentsQuerySchema = paginationQuerySchema.extend({
    employee_id: z.string().uuid().optional(),
    house_id: z.string().uuid().optional(),
    status: taskStatus.optional(),
    due_from: z.coerce.date().optional(),
    due_to: z.coerce.date().optional(),
});

export type CreateTaskAssignmentInput = z.infer<typeof createTaskAssignmentSchema> & { assigned_by_id: string };
export type UpdateTaskAssignmentInput = z.infer<typeof updateTaskAssignmentSchema>;
export type CompleteTaskAssignmentInput = z.infer<typeof completeTaskAssignmentSchema>;
export type ListTaskAssignmentsQuery = z.infer<typeof listTaskAssignmentsQuerySchema>;
