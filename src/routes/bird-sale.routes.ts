import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { BirdSaleController } from "@controllers/bird-sale.controller";
import { createBirdSaleSchema, listBirdSalesQuerySchema } from "@validators/bird-sale.validator";

export const birdSaleRoutes = new Hono();

birdSaleRoutes.get(
    "/",
    zValidatorRfc7807("query", listBirdSalesQuerySchema),
    BirdSaleController.getAll,
);
birdSaleRoutes.get("/:id", BirdSaleController.getById);
birdSaleRoutes.post(
    "/",
    zValidatorRfc7807("json", createBirdSaleSchema),
    BirdSaleController.create,
);
