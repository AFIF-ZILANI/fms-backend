// What a batch fell sick with (Newcastle, Gumboro, CRD...) -- the lookup behind the disease case picker.
import { Hono } from "hono";
import prisma from "@lib/db";
import { zValidatorRfc7807 } from "@lib/validator";
import { createLookupService, createLookupController } from "@lib/lookup-factory";
import {
    createLookupSchema,
    updateLookupSchema,
    listLookupQuerySchema,
} from "@validators/lookup.validator";

const service = createLookupService(prisma.disease, "Disease");
const controller = createLookupController(service);

export const diseaseRoutes = new Hono();

diseaseRoutes.get("/", zValidatorRfc7807("query", listLookupQuerySchema), controller.getAll);
diseaseRoutes.post("/", zValidatorRfc7807("json", createLookupSchema), controller.create);
diseaseRoutes.patch("/:id", zValidatorRfc7807("json", updateLookupSchema), controller.update);
diseaseRoutes.post("/:id/deactivate", controller.deactivate);
diseaseRoutes.post("/:id/reactivate", controller.reactivate);
diseaseRoutes.delete("/:id", controller.remove);
