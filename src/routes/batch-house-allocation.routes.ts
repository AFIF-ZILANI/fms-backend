import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { BatchHouseAllocationController } from "@controllers/batch-house-allocation.controller";
import {
    createAllocationSchema,
    listAllocationsQuerySchema,
} from "@validators/batch-house-allocation.validator";

export const batchHouseAllocationRoutes = new Hono();

batchHouseAllocationRoutes.get(
    "/",
    zValidatorRfc7807("query", listAllocationsQuerySchema),
    BatchHouseAllocationController.getAll,
);
batchHouseAllocationRoutes.post(
    "/",
    zValidatorRfc7807("json", createAllocationSchema),
    BatchHouseAllocationController.create,
);
