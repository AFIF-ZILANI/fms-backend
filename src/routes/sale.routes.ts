import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { SaleController } from "@controllers/sale.controller";
import { createSaleSchema, listSalesQuerySchema } from "@validators/sale.validator";

export const saleRoutes = new Hono();

saleRoutes.get("/", zValidatorRfc7807("query", listSalesQuerySchema), SaleController.getAll);
saleRoutes.get("/:id", SaleController.getById);
saleRoutes.post("/", zValidatorRfc7807("json", createSaleSchema), SaleController.create);
