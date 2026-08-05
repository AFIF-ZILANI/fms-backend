import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import {
    OrganizationController,
    ItemOrganizationController,
} from "@controllers/organization.controller";
import {
    createOrganizationSchema,
    updateOrganizationSchema,
    listOrganizationsQuerySchema,
    createItemOrganizationSchema,
} from "@validators/organization.validator";

export const organizationRoutes = new Hono();

organizationRoutes.get(
    "/",
    zValidatorRfc7807("query", listOrganizationsQuerySchema),
    OrganizationController.getAll,
);
organizationRoutes.get("/:id", OrganizationController.getById);
organizationRoutes.post(
    "/",
    zValidatorRfc7807("json", createOrganizationSchema),
    OrganizationController.create,
);
organizationRoutes.patch(
    "/:id",
    zValidatorRfc7807("json", updateOrganizationSchema),
    OrganizationController.update,
);

export const itemOrganizationRoutes = new Hono();

itemOrganizationRoutes.post(
    "/",
    zValidatorRfc7807("json", createItemOrganizationSchema),
    ItemOrganizationController.create,
);
itemOrganizationRoutes.delete("/:id", ItemOrganizationController.remove);
