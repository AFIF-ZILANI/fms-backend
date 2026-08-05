import type { ZodSchema } from "zod";
import { zValidator } from "@hono/zod-validator";
import { AppError } from "@lib/app-error";

/**
 * Zod validator that throws RFC 7807 Problem Details on validation failure.
 *
 * @example
 *   userRoutes.post("/", zValidatorRfc7807("json", createUserSchema), UserController.create);
 */
export const zValidatorRfc7807 = <T extends ZodSchema>(
    target: "json" | "query" | "param" | "header",
    schema: T,
) =>
    zValidator(target, schema, (result) => {
        if (!result.success) {
            const fields: Record<string, string> = {};
            for (const issue of result.error.issues) {
                const key = issue.path.join(".");
                fields[key || "_root"] = issue.message;
            }
            throw AppError.badRequest("Validation failed", { fields });
        }
    });
