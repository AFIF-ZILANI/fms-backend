import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { TransferController } from "@controllers/transfer.controller";
import { createStockTransferSchema } from "@validators/transfer.validator";

export const transferRoutes = new Hono();

transferRoutes.post(
    "/",
    zValidatorRfc7807("json", createStockTransferSchema),
    TransferController.create,
);
