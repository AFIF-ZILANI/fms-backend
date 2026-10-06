import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { AuthController } from "@controllers/auth.controller";
import { changePasswordSchema, loginSchema } from "@validators/auth.validator";

export const authRoutes = new Hono();

authRoutes.post("/login", zValidatorRfc7807("json", loginSchema), AuthController.login);
authRoutes.post("/logout", AuthController.logout);
authRoutes.get("/me", AuthController.me);
authRoutes.post(
    "/change-password",
    zValidatorRfc7807("json", changePasswordSchema),
    AuthController.changePassword,
);
