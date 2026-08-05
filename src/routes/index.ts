import { Hono } from "hono";
import { adminRoutes } from "@routes/admin.routes";
import { employeeRoutes } from "@routes/employee.routes";

export const appRoutes = new Hono();

appRoutes.route("/admins", adminRoutes);
appRoutes.route("/employees", employeeRoutes);
