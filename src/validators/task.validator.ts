import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

export const createTaskSchema = z.object({
    label: z.string().trim().min(1, "Label is required"),
    // null = a plain mark-done task ("Fix water line"); a TaskType id makes the
    // mobile app open that type's form instead.
    task_type_id: z.string().uuid().nullable().optional(),
});

// `code` is deliberately absent: it's derived from the label at create and
// never rewritten, since the mobile app routes on it (see TaskService.update).
export const updateTaskSchema = z
    .object({
        label: z.string().trim().min(1, "Label is required").optional(),
        task_type_id: z.string().uuid().nullable().optional(),
    })
    .refine((data) => data.label !== undefined || data.task_type_id !== undefined, {
        message: "Provide at least one of label/task_type_id",
    });

export const listTasksQuerySchema = paginationQuerySchema.extend({
    active: z.enum(["true", "false"]).optional(),
    task_type_id: z.string().uuid().optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
