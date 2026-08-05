import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { SupplierController } from "@controllers/supplier.controller";
import {
    createSupplierSchema,
    updateSupplierSchema,
    listSuppliersQuerySchema,
} from "@validators/supplier.validator";

export const supplierRoutes = new Hono();

supplierRoutes.get(
    "/",
    zValidatorRfc7807("query", listSuppliersQuerySchema),
    SupplierController.getAll,
);
supplierRoutes.get("/:id", SupplierController.getById);
supplierRoutes.post(
    "/",
    zValidatorRfc7807("json", createSupplierSchema),
    SupplierController.create,
);
supplierRoutes.patch(
    "/:id",
    zValidatorRfc7807("json", updateSupplierSchema),
    SupplierController.update,
);
supplierRoutes.post("/:id/deactivate", SupplierController.deactivate);
supplierRoutes.post("/:id/reactivate", SupplierController.reactivate);
