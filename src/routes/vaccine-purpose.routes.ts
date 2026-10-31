// What a vaccine is for (Gumboro, Ranikhet...) -- the lookup behind the template purpose dropdown.
import { Hono } from "hono";
import prisma from "@lib/db";
import { zValidatorRfc7807 } from "@lib/validator";
import { createLookupService, createLookupController } from "@lib/lookup-factory";
import {
    createLookupSchema,
    updateLookupSchema,
    listLookupQuerySchema,
} from "@validators/lookup.validator";

const service = createLookupService(prisma.vaccinePurpose, "VaccinePurpose");
const controller = createLookupController(service);

export const vaccinePurposeRoutes = new Hono();

vaccinePurposeRoutes.get("/", zValidatorRfc7807("query", listLookupQuerySchema), controller.getAll);
vaccinePurposeRoutes.post("/", zValidatorRfc7807("json", createLookupSchema), controller.create);
vaccinePurposeRoutes.patch(
    "/:id",
    zValidatorRfc7807("json", updateLookupSchema),
    controller.update,
);
vaccinePurposeRoutes.post("/:id/deactivate", controller.deactivate);
vaccinePurposeRoutes.post("/:id/reactivate", controller.reactivate);
vaccinePurposeRoutes.delete("/:id", controller.remove);
