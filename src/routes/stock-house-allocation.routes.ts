import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { StockHouseAllocationController } from "@controllers/stock-house-allocation.controller";
import { listStockHouseAllocationsQuerySchema } from "@validators/stock-house-allocation.validator";

export const stockHouseAllocationRoutes = new Hono();

stockHouseAllocationRoutes.get(
    "/",
    zValidatorRfc7807("query", listStockHouseAllocationsQuerySchema),
    StockHouseAllocationController.getAll,
);
