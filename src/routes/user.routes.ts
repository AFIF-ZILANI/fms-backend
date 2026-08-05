import { Hono } from "hono";
import { UserController } from "@controllers/user.controller";
import { createUserSchema, updateUserSchema } from "@validators/user.validator";
import { zValidatorRfc7807 } from "@lib/validator";

export const userRoutes = new Hono();

userRoutes.get("/", UserController.getAll);
userRoutes.get("/:id", UserController.getById);
userRoutes.post("/", zValidatorRfc7807("json", createUserSchema), UserController.create);
userRoutes.patch("/:id", zValidatorRfc7807("json", updateUserSchema), UserController.update);
userRoutes.delete("/:id", UserController.remove);
