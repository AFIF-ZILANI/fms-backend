import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { SaleController } from "@controllers/sale.controller";
import {
    createSaleSchema,
    listSalesQuerySchema,
    salesSummaryQuerySchema,
    sellableQuerySchema,
} from "@validators/sale.validator";

export const saleRoutes = new Hono();

saleRoutes.get("/", zValidatorRfc7807("query", listSalesQuerySchema), SaleController.getAll);
// Registered above "/:id" so the literal segment isn't captured as an id.
saleRoutes.get(
    "/summary",
    zValidatorRfc7807("query", salesSummaryQuerySchema),
    SaleController.summary,
);
saleRoutes.get(
    "/sellable",
    zValidatorRfc7807("query", sellableQuerySchema),
    SaleController.sellable,
);
saleRoutes.get("/:id", SaleController.getById);
saleRoutes.post("/", zValidatorRfc7807("json", createSaleSchema), SaleController.create);
