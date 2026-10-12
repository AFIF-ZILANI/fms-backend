import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { ConsumptionController } from "@controllers/consumption.controller";
import {
    createConsumptionSchema,
    listConsumptionsQuerySchema,
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
consumptionRoutes.post(
    "/",
    zValidatorRfc7807("json", createConsumptionSchema),
    ConsumptionController.create,
);
