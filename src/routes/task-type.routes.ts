import { Hono } from "hono";
import prisma from "@lib/db";
import { zValidatorRfc7807 } from "@lib/validator";
import { createLookupService, createLookupController } from "@lib/lookup-factory";
import {
    createLookupSchema,
    updateLookupSchema,
    listLookupQuerySchema,
} from "@validators/lookup.validator";

// stableCode: TaskType.code is the mobile app's routing key (it maps code ->
// screen), not a display artifact -- so a rename must not move it.
const service = createLookupService(prisma.taskType, "TaskType", { stableCode: true });
const controller = createLookupController(service);

export const taskTypeRoutes = new Hono();

taskTypeRoutes.get("/", zValidatorRfc7807("query", listLookupQuerySchema), controller.getAll);
taskTypeRoutes.post("/", zValidatorRfc7807("json", createLookupSchema), controller.create);
taskTypeRoutes.patch("/:id", zValidatorRfc7807("json", updateLookupSchema), controller.update);
taskTypeRoutes.post("/:id/deactivate", controller.deactivate);
taskTypeRoutes.post("/:id/reactivate", controller.reactivate);
taskTypeRoutes.delete("/:id", controller.remove);
