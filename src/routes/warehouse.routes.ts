import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { WarehouseController } from "@controllers/warehouse.controller";
import {
    createWarehouseSchema,
    updateWarehouseSchema,
    listWarehousesQuerySchema,
} from "@validators/warehouse.validator";

export const warehouseRoutes = new Hono();

warehouseRoutes.get(
    "/",
    zValidatorRfc7807("query", listWarehousesQuerySchema),
    WarehouseController.getAll,
);
warehouseRoutes.get("/:id", WarehouseController.getById);
warehouseRoutes.post(
    "/",
    zValidatorRfc7807("json", createWarehouseSchema),
    WarehouseController.create,
);
warehouseRoutes.patch(
    "/:id",
    zValidatorRfc7807("json", updateWarehouseSchema),
    WarehouseController.update,
);
