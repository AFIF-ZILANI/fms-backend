import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { SaleScanController } from "@controllers/sale-scan.controller";
import { scanBottleSchema } from "@validators/sale-scan.validator";

// Managers' side of a QR sale: no money in any response (lib/permissions.ts grants these to managers).
export const saleScanRoutes = new Hono();

saleScanRoutes.get("/", SaleScanController.waiting);
saleScanRoutes.get("/:id", SaleScanController.get);
saleScanRoutes.post(
    "/:id/scan",
    zValidatorRfc7807("json", scanBottleSchema),
    SaleScanController.scan,
);
