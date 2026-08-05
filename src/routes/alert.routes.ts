import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { AlertController } from "@controllers/alert.controller";
import { createAlertSchema, listAlertsQuerySchema } from "@validators/alert.validator";

export const alertRoutes = new Hono();

alertRoutes.get("/", zValidatorRfc7807("query", listAlertsQuerySchema), AlertController.getAll);
alertRoutes.post("/scan", AlertController.scan);
alertRoutes.get("/:id", AlertController.getById);
alertRoutes.post("/", zValidatorRfc7807("json", createAlertSchema), AlertController.create);
alertRoutes.post("/:id/resolve", AlertController.resolve);
