import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { BatchController } from "@controllers/batch.controller";
import {
    createBatchSchema,
    updateBatchSchema,
    closeBatchSchema,
    listBatchesQuerySchema,
} from "@validators/batch.validator";

export const batchRoutes = new Hono();

batchRoutes.get("/", zValidatorRfc7807("query", listBatchesQuerySchema), BatchController.getAll);
batchRoutes.get("/:id", BatchController.getById);
batchRoutes.post("/", zValidatorRfc7807("json", createBatchSchema), BatchController.create);
batchRoutes.patch("/:id", zValidatorRfc7807("json", updateBatchSchema), BatchController.update);
batchRoutes.post("/:id/close", zValidatorRfc7807("json", closeBatchSchema), BatchController.close);
