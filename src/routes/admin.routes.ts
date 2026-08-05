import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { AdminController } from "@controllers/admin.controller";
import {
    createAdminSchema,
    updateAdminSchema,
    listAdminsQuerySchema,
} from "@validators/admin.validator";

export const adminRoutes = new Hono();

adminRoutes.get("/", zValidatorRfc7807("query", listAdminsQuerySchema), AdminController.getAll);
adminRoutes.get("/:id", AdminController.getById);
adminRoutes.post("/", zValidatorRfc7807("json", createAdminSchema), AdminController.create);
adminRoutes.patch("/:id", zValidatorRfc7807("json", updateAdminSchema), AdminController.update);
adminRoutes.post("/:id/deactivate", AdminController.deactivate);
adminRoutes.post("/:id/reactivate", AdminController.reactivate);
