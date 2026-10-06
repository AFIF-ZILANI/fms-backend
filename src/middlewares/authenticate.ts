import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { SESSION_COOKIE, verifySession } from "@lib/session";
import type { AuthContext } from "../types/app";

// Reachable without a session. /ingest/v1/sales proves itself with a device
// token (requireDevice) instead; logout is idempotent so it works with an
// expired session too.
const PUBLIC = new Set([
    "POST /api/auth/login",
    "POST /api/auth/logout",
    "POST /api/ingest/v1/pair",
    "POST /api/ingest/v1/sales",
]);

// All a person on a temp password may do: see who they are and change it.
const PASSWORD_CHANGE_ALLOWED = new Set([
    "/api/auth/me",
    "/api/auth/change-password",
    "/api/auth/logout",
]);

function tokenFrom(c: Context): string {
    const header = c.req.header("Authorization") ?? "";
    if (header.startsWith("Bearer ")) return header.slice(7);
    return getCookie(c, SESSION_COOKIE) ?? "";
}

/** Default-deny for /api: every route needs a valid session unless listed in PUBLIC.
 * The profile is re-read on every request, so deactivating someone or changing
 * their password cuts off their existing tokens immediately. */
export async function authenticate(c: Context, next: Next) {
    if (PUBLIC.has(`${c.req.method} ${c.req.path}`)) return next();

    const claims = await verifySession(tokenFrom(c));
    if (!claims) throw AppError.unauthorized();

    const profile = await prisma.profiles.findUnique({
        where: { id: claims.sub },
        select: {
            id: true,
            role: true,
            is_active: true,
            must_change_password: true,
            password_changed_at: true,
            employees: { select: { role: true } },
        },
    });
    if (
        !profile ||
        !profile.is_active ||
        (profile.password_changed_at?.getTime() ?? 0) !== claims.pv
    ) {
        throw AppError.unauthorized();
    }

    if (profile.must_change_password && !PASSWORD_CHANGE_ALLOWED.has(c.req.path)) {
        throw new AppError({
            message: "You must change your temporary password first",
            status: 403,
            extensions: { code: "PASSWORD_CHANGE_REQUIRED" },
        });
    }

    const auth: AuthContext = {
        profile_id: profile.id,
        role: profile.role,
        employee_role: profile.employees?.role ?? null,
    };
    c.set("auth", auth);
    await next();
}

export function getAuth(c: Context): AuthContext {
    const auth = c.get("auth") as AuthContext | undefined;
    if (!auth) throw AppError.unauthorized();
    return auth;
}
