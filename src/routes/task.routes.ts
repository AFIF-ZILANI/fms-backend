import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { TaskController } from "@controllers/task.controller";
import {
    createTaskSchema,
    updateTaskSchema,
    listTasksQuerySchema,
} from "@validators/task.validator";

export const taskRoutes = new Hono();

taskRoutes.get("/", zValidatorRfc7807("query", listTasksQuerySchema), TaskController.getAll);
taskRoutes.get("/:id", TaskController.getById);
taskRoutes.post("/", zValidatorRfc7807("json", createTaskSchema), TaskController.create);
taskRoutes.patch("/:id", zValidatorRfc7807("json", updateTaskSchema), TaskController.update);
taskRoutes.post("/:id/deactivate", TaskController.deactivate);
taskRoutes.post("/:id/reactivate", TaskController.reactivate);
taskRoutes.delete("/:id", TaskController.remove);
