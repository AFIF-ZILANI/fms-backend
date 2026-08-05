import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { MedicationController } from "@controllers/medication.controller";
import {
    createMedicationSchema,
    listMedicationsQuerySchema,
} from "@validators/medication.validator";

export const medicationRoutes = new Hono();

medicationRoutes.get(
    "/",
    zValidatorRfc7807("query", listMedicationsQuerySchema),
    MedicationController.getAll,
);
medicationRoutes.post(
    "/",
    zValidatorRfc7807("json", createMedicationSchema),
    MedicationController.create,
);
