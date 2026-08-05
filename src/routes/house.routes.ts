import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { HouseController } from "@controllers/house.controller";
import {
    createHouseSchema,
    updateHouseSchema,
    listHousesQuerySchema,
} from "@validators/house.validator";

export const houseRoutes = new Hono();

houseRoutes.get("/", zValidatorRfc7807("query", listHousesQuerySchema), HouseController.getAll);
houseRoutes.get("/:id", HouseController.getById);
houseRoutes.post("/", zValidatorRfc7807("json", createHouseSchema), HouseController.create);
houseRoutes.patch("/:id", zValidatorRfc7807("json", updateHouseSchema), HouseController.update);
houseRoutes.post("/:id/deactivate", HouseController.deactivate);
houseRoutes.post("/:id/reactivate", HouseController.reactivate);
