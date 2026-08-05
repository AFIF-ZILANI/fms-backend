import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { StockLedgerController } from "@controllers/stock-ledger.controller";
import { listStockLedgerQuerySchema } from "@validators/stock-ledger.validator";

export const stockLedgerRoutes = new Hono();

stockLedgerRoutes.get(
    "/",
    zValidatorRfc7807("query", listStockLedgerQuerySchema),
    StockLedgerController.getAll,
);
