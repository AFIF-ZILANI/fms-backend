import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { TaskAssignmentController } from "@controllers/task-assignment.controller";
import {
    createTaskAssignmentSchema,
    updateTaskAssignmentSchema,
    completeTaskAssignmentSchema,
    listTaskAssignmentsQuerySchema,
} from "@validators/task-assignment.validator";

export const taskAssignmentRoutes = new Hono();

taskAssignmentRoutes.get(
    "/",
    zValidatorRfc7807("query", listTaskAssignmentsQuerySchema),
    TaskAssignmentController.getAll,
);
taskAssignmentRoutes.get("/:id", TaskAssignmentController.getById);
taskAssignmentRoutes.post(
    "/",
    zValidatorRfc7807("json", createTaskAssignmentSchema),
    TaskAssignmentController.create,
);
taskAssignmentRoutes.patch(
    "/:id",
    zValidatorRfc7807("json", updateTaskAssignmentSchema),
    TaskAssignmentController.update,
);
taskAssignmentRoutes.post(
    "/:id/complete",
    zValidatorRfc7807("json", completeTaskAssignmentSchema),
    TaskAssignmentController.complete,
);
taskAssignmentRoutes.post("/:id/cancel", TaskAssignmentController.cancel);
