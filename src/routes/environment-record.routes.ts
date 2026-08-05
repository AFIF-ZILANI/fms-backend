import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { EnvironmentRecordController } from "@controllers/environment-record.controller";
import {
    createEnvironmentRecordSchema,
    listEnvironmentRecordsQuerySchema,
} from "@validators/environment-record.validator";

export const environmentRecordRoutes = new Hono();

environmentRecordRoutes.get(
    "/",
    zValidatorRfc7807("query", listEnvironmentRecordsQuerySchema),
    EnvironmentRecordController.getAll,
);
environmentRecordRoutes.post(
    "/",
    zValidatorRfc7807("json", createEnvironmentRecordSchema),
    EnvironmentRecordController.create,
);
