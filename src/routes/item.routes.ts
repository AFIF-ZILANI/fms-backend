import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { ItemController } from "@controllers/item.controller";
import {
    createItemSchema,
    updateItemSchema,
    listItemsQuerySchema,
} from "@validators/item.validator";

export const itemRoutes = new Hono();

itemRoutes.get("/", zValidatorRfc7807("query", listItemsQuerySchema), ItemController.getAll);
itemRoutes.get("/:id", ItemController.getById);
itemRoutes.post("/", zValidatorRfc7807("json", createItemSchema), ItemController.create);
itemRoutes.patch("/:id", zValidatorRfc7807("json", updateItemSchema), ItemController.update);
itemRoutes.post("/:id/deactivate", ItemController.deactivate);
itemRoutes.post("/:id/reactivate", ItemController.reactivate);
