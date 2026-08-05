import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { CustomerController } from "@controllers/customer.controller";
import {
    createCustomerSchema,
    updateCustomerSchema,
    listCustomersQuerySchema,
} from "@validators/customer.validator";

export const customerRoutes = new Hono();

customerRoutes.get(
    "/",
    zValidatorRfc7807("query", listCustomersQuerySchema),
    CustomerController.getAll,
);
customerRoutes.get("/:id", CustomerController.getById);
customerRoutes.post(
    "/",
    zValidatorRfc7807("json", createCustomerSchema),
    CustomerController.create,
);
customerRoutes.patch(
    "/:id",
    zValidatorRfc7807("json", updateCustomerSchema),
    CustomerController.update,
);
customerRoutes.post("/:id/deactivate", CustomerController.deactivate);
customerRoutes.post("/:id/reactivate", CustomerController.reactivate);
