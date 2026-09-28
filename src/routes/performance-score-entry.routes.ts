import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { PerformanceScoreEntryController } from "@controllers/performance-score-entry.controller";
import {
    createScoreEntrySchema,
    listScoreEntriesQuerySchema,
    voidScoreEntrySchema,
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
// Entries are never deleted -- there is no DELETE here on purpose.
performanceScoreEntryRoutes.post(
    "/:id/void",
    zValidatorRfc7807("json", voidScoreEntrySchema),
    PerformanceScoreEntryController.void,
);
performanceScoreEntryRoutes.post("/:id/dispute", PerformanceScoreEntryController.dispute);
performanceScoreEntryRoutes.post("/:id/acknowledge", PerformanceScoreEntryController.acknowledge);
