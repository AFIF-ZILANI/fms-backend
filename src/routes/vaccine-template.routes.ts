import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { VaccineTemplateController } from "@controllers/vaccine-template.controller";
import {
    createVaccineTemplateSchema,
    listVaccineTemplatesQuerySchema,
    updateVaccineTemplateSchema,
} from "@validators/vaccine-template.validator";

export const vaccineTemplateRoutes = new Hono();

vaccineTemplateRoutes.get(
    "/",
    zValidatorRfc7807("query", listVaccineTemplatesQuerySchema),
    VaccineTemplateController.getAll,
);
vaccineTemplateRoutes.get("/:id", VaccineTemplateController.getById);
vaccineTemplateRoutes.post(
    "/",
    zValidatorRfc7807("json", createVaccineTemplateSchema),
    VaccineTemplateController.create,
);
vaccineTemplateRoutes.patch(
    "/:id",
    zValidatorRfc7807("json", updateVaccineTemplateSchema),
    VaccineTemplateController.update,
);
