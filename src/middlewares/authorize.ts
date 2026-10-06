import type { Context, Next } from "hono";
import { AppError } from "@lib/app-error";
import { canAccess } from "@lib/permissions";
import type { AuthContext } from "../types/app";

/** Runs after authenticate. Routes with no session (the public ones) pass through untouched. */
export async function authorize(c: Context, next: Next) {
    const auth = c.get("auth") as AuthContext | undefined;
    if (!auth) return next();

    const path = c.req.path.replace(/^\/api/, "") || "/";
    // Everyone logged in may use their own account endpoints.
    if (path.startsWith("/auth/")) return next();

    if (!canAccess(auth, c.req.method, path, (name) => c.req.query(name))) {
        throw AppError.forbidden("You don't have access to this");
    }
    await next();
}
