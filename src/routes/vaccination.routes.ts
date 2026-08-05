import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { VaccinationController } from "@controllers/vaccination.controller";
import {
    createVaccinationSchema,
    listVaccinationsQuerySchema,
} from "@validators/vaccination.validator";

export const vaccinationRoutes = new Hono();

vaccinationRoutes.get(
    "/",
    zValidatorRfc7807("query", listVaccinationsQuerySchema),
    VaccinationController.getAll,
);
vaccinationRoutes.post(
    "/",
    zValidatorRfc7807("json", createVaccinationSchema),
    VaccinationController.create,
);
