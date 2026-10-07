import type { Context } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import env from "@config/env";
import { withHandler } from "@lib/helper";
import { sendSuccess } from "@lib/response";
import { getValid } from "@lib/valid";
import { SESSION_COOKIE, SESSION_TTL, type SessionClient } from "@lib/session";
import { AuthService } from "@services/auth.service";
import { getAuth } from "@middlewares/authenticate";
import type {
    ChangePasswordInput,
    DeactivateAccountInput,
    LoginInput,
    UpdateAccountInput,
} from "@validators/auth.validator";

const cookieOptions = {
    httpOnly: true,
    sameSite: "Lax",
    secure: env.NODE_ENV === "production",
    path: "/",
} as const;

/** Web gets an httpOnly cookie (JS never sees the token); mobile gets it in the body. */
function deliver(c: Context, client: SessionClient, token: string) {
    if (client === "mobile") return { token };
    setCookie(c, SESSION_COOKIE, token, { ...cookieOptions, maxAge: SESSION_TTL.web });
    return {};
}

export const AuthController = {
    async login(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<LoginInput>(c, "json");
            const { token, profile } = await AuthService.login(
                body.email,
                body.password,
                body.client,
            );
            return sendSuccess(c, { profile, ...deliver(c, body.client, token) }, "Logged in");
        });
    },

    async logout(c: Context) {
        return withHandler(c, async () => {
            deleteCookie(c, SESSION_COOKIE, { path: "/" });
            return sendSuccess(c, null, "Logged out");
        });
    },

    async me(c: Context) {
        return withHandler(c, async () => {
            const me = await AuthService.me(getAuth(c).profile_id);
            return sendSuccess(c, me, "Fetched successfully");
        });
    },

    async account(c: Context) {
        return withHandler(c, async () =>
            sendSuccess(c, await AuthService.account(getAuth(c).profile_id), "Fetched successfully"),
        );
    },

    async updateAccount(c: Context) {
        return withHandler(c, async () =>
            sendSuccess(
                c,
                await AuthService.updateAccount(getAuth(c).profile_id, getValid<UpdateAccountInput>(c, "json")),
                "Account updated",
            ),
        );
    },

    async deactivateAccount(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<DeactivateAccountInput>(c, "json");
            await AuthService.deactivateSelf(getAuth(c).profile_id, body.password);
            deleteCookie(c, SESSION_COOKIE, { path: "/" });
            return sendSuccess(c, null, "Account deactivated");
        });
    },

    async changePassword(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<ChangePasswordInput>(c, "json");
            // A request that came with a bearer token is the phone; otherwise it's the browser.
            const client: SessionClient = c.req.header("Authorization") ? "mobile" : "web";
            const { token } = await AuthService.changePassword(
                getAuth(c).profile_id,
                body.current_password,
                body.new_password,
                client,
            );
            return sendSuccess(c, deliver(c, client, token), "Password changed");
        });
    },
};
