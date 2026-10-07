import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { AuthController } from "@controllers/auth.controller";
import {
    changePasswordSchema,
    deactivateAccountSchema,
    loginSchema,
    updateAccountSchema,
} from "@validators/auth.validator";

export const authRoutes = new Hono();

authRoutes.post("/login", zValidatorRfc7807("json", loginSchema), AuthController.login);
authRoutes.post("/logout", AuthController.logout);
authRoutes.get("/me", AuthController.me);
authRoutes.post(
    "/change-password",
    zValidatorRfc7807("json", changePasswordSchema),
    AuthController.changePassword,
);
authRoutes.get("/account", AuthController.account);
authRoutes.patch("/account", zValidatorRfc7807("json", updateAccountSchema), AuthController.updateAccount);
authRoutes.post(
    "/deactivate-account",
    zValidatorRfc7807("json", deactivateAccountSchema),
    AuthController.deactivateAccount,
);
