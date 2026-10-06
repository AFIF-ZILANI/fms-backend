import { sign, verify } from "hono/jwt";
import env from "@config/env";

export type SessionClient = "web" | "mobile";

/** Seconds. Web is a desk; the phone is in a shed with no signal and is re-logged-in rarely. */
export const SESSION_TTL: Record<SessionClient, number> = {
    web: 7 * 24 * 3600,
    mobile: 30 * 24 * 3600,
};

type SessionClaims = {
    sub: string; // profile id
    pv: number; // password_changed_at (ms): a password change invalidates older tokens
    exp: number;
};

export function signSession(profileId: string, passwordChangedAt: Date | null, client: SessionClient) {
    const claims: SessionClaims = {
        sub: profileId,
        pv: passwordChangedAt?.getTime() ?? 0,
        exp: Math.floor(Date.now() / 1000) + SESSION_TTL[client],
    };
    return sign(claims, env.SESSION_SECRET, "HS256");
}

/** Null for anything wrong with the token -- callers never learn why. */
export async function verifySession(token: string): Promise<SessionClaims | null> {
    try {
        const claims = (await verify(token, env.SESSION_SECRET, "HS256")) as Partial<SessionClaims>;
        if (typeof claims.sub !== "string" || typeof claims.pv !== "number") return null;
        return claims as SessionClaims;
    } catch {
        return null;
    }
}

export const SESSION_COOKIE = "fms_session";
