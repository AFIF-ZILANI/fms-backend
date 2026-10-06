import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { BonusEventController } from "@controllers/bonus-event.controller";
import {
    createBonusEventSchema,
    grantBonusesSchema,
    listBonusEventsQuerySchema,
} from "@validators/bonus-event.validator";

export const bonusEventRoutes = new Hono();

bonusEventRoutes.get(
    "/",
    zValidatorRfc7807("query", listBonusEventsQuerySchema),
    BonusEventController.getAll,
);
bonusEventRoutes.post("/", zValidatorRfc7807("json", createBonusEventSchema), BonusEventController.create);
bonusEventRoutes.get("/:id", BonusEventController.getById);
// Pure computation: GET, and writes nothing.
bonusEventRoutes.get("/:id/proposal", BonusEventController.proposal);
bonusEventRoutes.post("/:id/bonuses", zValidatorRfc7807("json", grantBonusesSchema), BonusEventController.grant);
