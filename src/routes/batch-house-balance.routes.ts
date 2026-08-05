import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { BatchHouseBalanceController } from "@controllers/batch-house-balance.controller";
import { listBalancesQuerySchema } from "@validators/batch-house-balance.validator";

export const batchHouseBalanceRoutes = new Hono();

batchHouseBalanceRoutes.get(
    "/",
    zValidatorRfc7807("query", listBalancesQuerySchema),
    BatchHouseBalanceController.getAll,
);
