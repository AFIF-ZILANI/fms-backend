import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { DeviceController } from "@controllers/device.controller";
import { createPairingCodeSchema } from "@validators/device.validator";

export const deviceRoutes = new Hono();

deviceRoutes.get("/", DeviceController.getAll);
deviceRoutes.post(
    "/pairing-codes",
    zValidatorRfc7807("json", createPairingCodeSchema),
    DeviceController.createPairingCode,
);
deviceRoutes.post("/:id/revoke", DeviceController.revoke);
