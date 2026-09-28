import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { EmployeePayoutAccountController } from "@controllers/employee-payout-account.controller";
import {
    createPayoutAccountSchema,
    listPayoutAccountsQuerySchema,
} from "@validators/employee-payout-account.validator";

export const employeePayoutAccountRoutes = new Hono();

employeePayoutAccountRoutes.get(
    "/",
    zValidatorRfc7807("query", listPayoutAccountsQuerySchema),
    EmployeePayoutAccountController.getAll,
);
employeePayoutAccountRoutes.get("/:id", EmployeePayoutAccountController.getById);
// Append-only: no PATCH and no DELETE. A change is a POST, which closes the
// account it replaces in the same transaction.
employeePayoutAccountRoutes.post(
    "/",
    zValidatorRfc7807("json", createPayoutAccountSchema),
    EmployeePayoutAccountController.create,
);
employeePayoutAccountRoutes.post("/:id/close", EmployeePayoutAccountController.close);
