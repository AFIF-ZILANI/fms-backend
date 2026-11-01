import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { FarmSettingsController } from "@controllers/farm-settings.controller";
import { updateFarmSettingsSchema } from "@validators/farm-settings.validator";

// Admin-only: employees aren't listed in lib/permissions.ts, so they get a 403. They read the hour from /auth/me.
export const farmSettingsRoutes = new Hono();

farmSettingsRoutes.get("/", FarmSettingsController.get);
farmSettingsRoutes.patch("/", zValidatorRfc7807("json", updateFarmSettingsSchema), FarmSettingsController.update);
