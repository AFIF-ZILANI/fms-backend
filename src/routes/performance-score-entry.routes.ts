import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { PerformanceScoreEntryController } from "@controllers/performance-score-entry.controller";
import {
    createScoreEntrySchema,
    listScoreEntriesQuerySchema,
} from "@validators/performance-score-entry.validator";

export const performanceScoreEntryRoutes = new Hono();

performanceScoreEntryRoutes.get(
    "/",
    zValidatorRfc7807("query", listScoreEntriesQuerySchema),
    PerformanceScoreEntryController.getAll,
);
performanceScoreEntryRoutes.post(
    "/",
    zValidatorRfc7807("json", createScoreEntrySchema),
    PerformanceScoreEntryController.create,
);
