import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { EmployeeController } from "@controllers/employee.controller";
import {
    createEmployeeSchema,
    updateEmployeeSchema,
    listEmployeesQuerySchema,
} from "@validators/employee.validator";

export const employeeRoutes = new Hono();

employeeRoutes.get(
    "/",
    zValidatorRfc7807("query", listEmployeesQuerySchema),
    EmployeeController.getAll,
);
employeeRoutes.get("/:id", EmployeeController.getById);
employeeRoutes.post(
    "/",
    zValidatorRfc7807("json", createEmployeeSchema),
    EmployeeController.create,
);
employeeRoutes.patch(
    "/:id",
    zValidatorRfc7807("json", updateEmployeeSchema),
    EmployeeController.update,
);
employeeRoutes.post("/:id/deactivate", EmployeeController.deactivate);
employeeRoutes.post("/:id/reactivate", EmployeeController.reactivate);
