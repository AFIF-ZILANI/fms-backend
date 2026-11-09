import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { DiseaseCaseController } from "@controllers/disease-case.controller";
import {
    createDiseaseCaseSchema,
    listDiseaseCasesQuerySchema,
    updateDiseaseCaseSchema,
} from "@validators/disease-case.validator";

export const diseaseCaseRoutes = new Hono();

diseaseCaseRoutes.get(
    "/",
    zValidatorRfc7807("query", listDiseaseCasesQuerySchema),
    DiseaseCaseController.getAll,
);
diseaseCaseRoutes.get("/:id", DiseaseCaseController.getById);
diseaseCaseRoutes.post(
    "/",
    zValidatorRfc7807("json", createDiseaseCaseSchema),
    DiseaseCaseController.create,
);
diseaseCaseRoutes.patch(
    "/:id",
    zValidatorRfc7807("json", updateDiseaseCaseSchema),
    DiseaseCaseController.update,
);
diseaseCaseRoutes.delete("/:id", DiseaseCaseController.remove);
