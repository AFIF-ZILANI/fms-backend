import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { PurchaseController, PurchaseItemController } from "@controllers/purchase.controller";
import {
    createPurchaseSchema,
    listPurchasesQuerySchema,
    listPurchaseItemsQuerySchema,
} from "@validators/purchase.validator";

export const purchaseRoutes = new Hono();

purchaseRoutes.get(
    "/",
    zValidatorRfc7807("query", listPurchasesQuerySchema),
    PurchaseController.getAll,
);
purchaseRoutes.get("/:id", PurchaseController.getById);
purchaseRoutes.post(
    "/",
    zValidatorRfc7807("json", createPurchaseSchema),
    PurchaseController.create,
);

export const purchaseItemRoutes = new Hono();

purchaseItemRoutes.get(
    "/",
    zValidatorRfc7807("query", listPurchaseItemsQuerySchema),
    PurchaseItemController.getAll,
);
