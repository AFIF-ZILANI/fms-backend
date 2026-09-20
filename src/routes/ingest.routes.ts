import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { requireDevice } from "../middlewares/require-device";
import { DeviceController } from "@controllers/device.controller";
import { IngestController } from "@controllers/ingest.controller";
import { redeemPairingSchema } from "@validators/device.validator";
import { ingestSaleSchema, listIngestedQuerySchema } from "@validators/ingest.validator";

// Versioned in the path from day one: PoultryScale has no OTA update channel,
// so builds already in the field will post here indefinitely. v1 never breaks.
export const ingestRoutes = new Hono();

// Pairing is the one route a phone reaches without a token -- the code IS the
// credential, and it is single-use and short-lived.
ingestRoutes.post(
    "/v1/pair",
    zValidatorRfc7807("json", redeemPairingSchema),
    DeviceController.redeemPairingCode,
);

ingestRoutes.post(
    "/v1/sales",
    requireDevice,
    zValidatorRfc7807("json", ingestSaleSchema),
    IngestController.create,
);

// Dashboard-facing read of the staging queue. Not device-authenticated: it is
// the same trusted LAN surface as the rest of the dashboard.
ingestRoutes.get(
    "/v1/sales",
    zValidatorRfc7807("query", listIngestedQuerySchema),
    IngestController.getAll,
);
