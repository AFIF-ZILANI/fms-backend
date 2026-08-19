import { Hono } from "hono";
import prisma from "@lib/db";
import { zValidatorRfc7807 } from "@lib/validator";
import { createLookupService, createLookupController } from "@lib/lookup-factory";
import { createLookupSchema, updateLookupSchema, listLookupQuerySchema } from "@validators/lookup.validator";

const service = createLookupService(prisma.expenseCategoryLookup, "ExpenseCategory");
const controller = createLookupController(service);

export const expenseCategoryRoutes = new Hono();

expenseCategoryRoutes.get("/", zValidatorRfc7807("query", listLookupQuerySchema), controller.getAll);
expenseCategoryRoutes.post("/", zValidatorRfc7807("json", createLookupSchema), controller.create);
expenseCategoryRoutes.patch("/:id", zValidatorRfc7807("json", updateLookupSchema), controller.update);
expenseCategoryRoutes.post("/:id/deactivate", controller.deactivate);
expenseCategoryRoutes.post("/:id/reactivate", controller.reactivate);
expenseCategoryRoutes.delete("/:id", controller.remove);
