import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { MortalityLogController } from "@controllers/mortality-log.controller";
import {
    createMortalityLogSchema,
    listMortalityLogsQuerySchema,
    setMortalityDiseaseCaseSchema,
} from "@validators/mortality-log.validator";

export const mortalityLogRoutes = new Hono();

mortalityLogRoutes.get(
    "/",
    zValidatorRfc7807("query", listMortalityLogsQuerySchema),
    MortalityLogController.getAll,
);
mortalityLogRoutes.post(
    "/",
    zValidatorRfc7807("json", createMortalityLogSchema),
    MortalityLogController.create,
);
// Admin-only: no permissions rule grants PATCH on mortality logs to employees.
mortalityLogRoutes.patch(
    "/:id",
    zValidatorRfc7807("json", setMortalityDiseaseCaseSchema),
    MortalityLogController.setDiseaseCase,
);
