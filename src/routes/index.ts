import { Hono } from "hono";
import { adminRoutes } from "@routes/admin.routes";

export const appRoutes = new Hono();

appRoutes.route("/admins", adminRoutes);
