import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { WeightRecordController } from "@controllers/weight-record.controller";
import {
    createWeightRecordSchema,
    listWeightRecordsQuerySchema,
} from "@validators/weight-record.validator";

export const weightRecordRoutes = new Hono();

weightRecordRoutes.get(
    "/",
    zValidatorRfc7807("query", listWeightRecordsQuerySchema),
    WeightRecordController.getAll,
);
weightRecordRoutes.post(
    "/",
    zValidatorRfc7807("json", createWeightRecordSchema),
    WeightRecordController.create,
);
