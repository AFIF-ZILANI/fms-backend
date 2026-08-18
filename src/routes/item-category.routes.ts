import { Hono } from "hono";
import prisma from "@lib/db";
import { zValidatorRfc7807 } from "@lib/validator";
import { createLookupService, createLookupController } from "@lib/lookup-factory";
import { createLookupSchema, updateLookupSchema, listLookupQuerySchema } from "@validators/lookup.validator";

const service = createLookupService(prisma.itemCategory, "ItemCategory");
const controller = createLookupController(service);

export const itemCategoryRoutes = new Hono();

itemCategoryRoutes.get("/", zValidatorRfc7807("query", listLookupQuerySchema), controller.getAll);
itemCategoryRoutes.post("/", zValidatorRfc7807("json", createLookupSchema), controller.create);
itemCategoryRoutes.patch("/:id", zValidatorRfc7807("json", updateLookupSchema), controller.update);
itemCategoryRoutes.post("/:id/deactivate", controller.deactivate);
itemCategoryRoutes.post("/:id/reactivate", controller.reactivate);
