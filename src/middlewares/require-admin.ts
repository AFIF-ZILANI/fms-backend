import type { Context, Next } from "hono";
import { AppError } from "@lib/app-error";
import { getAuth } from "./authenticate";

export async function requireAdmin(c: Context, next: Next) {
    if (getAuth(c).role !== "ADMIN") throw AppError.forbidden("Admins only");
    await next();
}
