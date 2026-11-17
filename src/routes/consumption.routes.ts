import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { ConsumptionController } from "@controllers/consumption.controller";
import {
    createConsumptionSchema,
    fixConsumptionSchema,
    listConsumptionsQuerySchema,
    removeConsumptionSchema,
} from "@validators/consumption.validator";
import { stockActivitySummaryQuerySchema } from "@validators/stock-activity.validator";

export const consumptionRoutes = new Hono();

consumptionRoutes.get(
    "/",
    zValidatorRfc7807("query", listConsumptionsQuerySchema),
    ConsumptionController.getAll,
);
consumptionRoutes.get(
    "/summary",
    zValidatorRfc7807("query", stockActivitySummaryQuerySchema),
    ConsumptionController.summary,
);
consumptionRoutes.get("/:id", ConsumptionController.getById);
consumptionRoutes.post(
    "/",
    zValidatorRfc7807("json", createConsumptionSchema),
    ConsumptionController.create,
);
// Fix usage (docs/usage-fix-design.md). Remove is a POST: it carries a reason, and DELETE bodies don't travel.
consumptionRoutes.patch(
    "/:id",
    zValidatorRfc7807("json", fixConsumptionSchema),
    ConsumptionController.fix,
);
consumptionRoutes.post(
    "/:id/remove",
    zValidatorRfc7807("json", removeConsumptionSchema),
    ConsumptionController.remove,
);
