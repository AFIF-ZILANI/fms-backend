import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { BatchFeedingProgramController } from "@controllers/batch-feeding-program.controller";
import {
    createFeedingProgramSchema,
    updateFeedingProgramSchema,
    listFeedingProgramsQuerySchema,
} from "@validators/batch-feeding-program.validator";

export const batchFeedingProgramRoutes = new Hono();

batchFeedingProgramRoutes.get(
    "/",
    zValidatorRfc7807("query", listFeedingProgramsQuerySchema),
    BatchFeedingProgramController.getAll,
);
batchFeedingProgramRoutes.post(
    "/",
    zValidatorRfc7807("json", createFeedingProgramSchema),
    BatchFeedingProgramController.create,
);
batchFeedingProgramRoutes.patch(
    "/:id",
    zValidatorRfc7807("json", updateFeedingProgramSchema),
    BatchFeedingProgramController.setEndDay,
);
