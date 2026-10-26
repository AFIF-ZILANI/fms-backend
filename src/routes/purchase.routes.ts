import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { PurchaseController, PurchaseItemController } from "@controllers/purchase.controller";
import {
    createPurchaseSchema,
    addPurchaseChargeSchema,
    listPurchasesQuerySchema,
    listPurchaseItemsQuerySchema,
    completePurchaseItemSchema,
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
purchaseRoutes.post(
    "/:id/charges",
    zValidatorRfc7807("json", addPurchaseChargeSchema),
    PurchaseController.addCharge,
);

export const purchaseItemRoutes = new Hono();

purchaseItemRoutes.get(
    "/",
    zValidatorRfc7807("query", listPurchaseItemsQuerySchema),
    PurchaseItemController.getAll,
);
purchaseItemRoutes.post(
    "/:id/complete",
    zValidatorRfc7807("json", completePurchaseItemSchema),
    PurchaseItemController.complete,
);
