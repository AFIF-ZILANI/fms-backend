import { Hono } from "hono";
import { adminRoutes } from "@routes/admin.routes";
import { employeeRoutes } from "@routes/employee.routes";
import { supplierRoutes } from "@routes/supplier.routes";
import { customerRoutes } from "@routes/customer.routes";
import { doctorRoutes } from "@routes/doctor.routes";

export const appRoutes = new Hono();

appRoutes.route("/admins", adminRoutes);
appRoutes.route("/employees", employeeRoutes);
appRoutes.route("/suppliers", supplierRoutes);
appRoutes.route("/customers", customerRoutes);
appRoutes.route("/doctors", doctorRoutes);
