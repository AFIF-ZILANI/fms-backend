import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { EmployeeRoleController } from "@controllers/employee-role.controller";
import {
    createEmployeeRoleSchema,
    updateEmployeeRoleSchema,
    listEmployeeRolesQuerySchema,
} from "@validators/employee-role.validator";

export const employeeRoleRoutes = new Hono();

employeeRoleRoutes.get("/", zValidatorRfc7807("query", listEmployeeRolesQuerySchema), EmployeeRoleController.getAll);
employeeRoleRoutes.post("/", zValidatorRfc7807("json", createEmployeeRoleSchema), EmployeeRoleController.create);
employeeRoleRoutes.patch("/:id", zValidatorRfc7807("json", updateEmployeeRoleSchema), EmployeeRoleController.update);
employeeRoleRoutes.post("/:id/deactivate", EmployeeRoleController.deactivate);
employeeRoleRoutes.post("/:id/reactivate", EmployeeRoleController.reactivate);
employeeRoleRoutes.delete("/:id", EmployeeRoleController.remove);
