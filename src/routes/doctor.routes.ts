import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { DoctorController } from "@controllers/doctor.controller";
import { createDoctorSchema, listDoctorsQuerySchema } from "@validators/doctor.validator";

export const doctorRoutes = new Hono();

doctorRoutes.get("/", zValidatorRfc7807("query", listDoctorsQuerySchema), DoctorController.getAll);
doctorRoutes.get("/:id", DoctorController.getById);
doctorRoutes.post("/", zValidatorRfc7807("json", createDoctorSchema), DoctorController.create);
