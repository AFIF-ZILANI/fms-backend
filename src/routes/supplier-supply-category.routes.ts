import { Hono } from "hono";
import prisma from "@lib/db";
import { zValidatorRfc7807 } from "@lib/validator";
import { createLookupService, createLookupController } from "@lib/lookup-factory";
import { createLookupSchema, updateLookupSchema, listLookupQuerySchema } from "@validators/lookup.validator";

const service = createLookupService(prisma.supplierSupplyCategory, "SupplierSupplyCategory");
const controller = createLookupController(service);

export const supplierSupplyCategoryRoutes = new Hono();

supplierSupplyCategoryRoutes.get("/", zValidatorRfc7807("query", listLookupQuerySchema), controller.getAll);
supplierSupplyCategoryRoutes.post("/", zValidatorRfc7807("json", createLookupSchema), controller.create);
supplierSupplyCategoryRoutes.patch("/:id", zValidatorRfc7807("json", updateLookupSchema), controller.update);
supplierSupplyCategoryRoutes.post("/:id/deactivate", controller.deactivate);
supplierSupplyCategoryRoutes.post("/:id/reactivate", controller.reactivate);
supplierSupplyCategoryRoutes.delete("/:id", controller.remove);
