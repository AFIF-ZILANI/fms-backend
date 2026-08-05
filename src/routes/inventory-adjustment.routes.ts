import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { InventoryAdjustmentController } from "@controllers/inventory-adjustment.controller";
import {
    createInventoryAdjustmentSchema,
    listInventoryAdjustmentsQuerySchema,
} from "@validators/inventory-adjustment.validator";

export const inventoryAdjustmentRoutes = new Hono();

inventoryAdjustmentRoutes.get(
    "/",
    zValidatorRfc7807("query", listInventoryAdjustmentsQuerySchema),
    InventoryAdjustmentController.getAll,
);
inventoryAdjustmentRoutes.post(
    "/",
    zValidatorRfc7807("json", createInventoryAdjustmentSchema),
    InventoryAdjustmentController.create,
);
