import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { StockUnitController } from "@controllers/stock-unit.controller";
import {
    provisionStockUnitsSchema,
    bindStockUnitSchema,
    relocateStockUnitSchema,
    listStockUnitsQuerySchema,
} from "@validators/stock-unit.validator";

export const stockUnitRoutes = new Hono();

stockUnitRoutes.get(
    "/",
    zValidatorRfc7807("query", listStockUnitsQuerySchema),
    StockUnitController.getAll,
);
stockUnitRoutes.get("/:id", StockUnitController.getById);
stockUnitRoutes.get("/code/:code", StockUnitController.getByCode);
stockUnitRoutes.post(
    "/",
    zValidatorRfc7807("json", provisionStockUnitsSchema),
    StockUnitController.provision,
);
stockUnitRoutes.post(
    "/:id/bind",
    zValidatorRfc7807("json", bindStockUnitSchema),
    StockUnitController.bind,
);
stockUnitRoutes.post(
    "/:id/relocate",
    zValidatorRfc7807("json", relocateStockUnitSchema),
    StockUnitController.relocate,
);
stockUnitRoutes.post("/:id/dispose", StockUnitController.dispose);
