import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { timeout } from "hono/timeout";
import { rateLimiter } from "hono-rate-limiter";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";

import { appRoutes } from "./routes/index";
import type { AppEnv } from "./types/app";
import { sendError, sendErrorRaw } from "./lib/response";
import { AppError } from "./lib/app-error";
import type { ErrorStatus } from "./lib/app-error";
import env from "./config/env";

export const app = new Hono<AppEnv>();

const isDev = env.NODE_ENV === "development";
const allowedOrigins = env.ALLOWED_ORIGINS.split(",");

// --- Security Headers ---
app.use(
    "*",
    secureHeaders({
        contentSecurityPolicy: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: [],
        },
        xFrameOptions: "DENY",
        referrerPolicy: "strict-origin-when-cross-origin",
    }),
);

// --- CSRF Protection (skip in dev) ---
if (!isDev && env.CSRF_ENABLED) {
    app.use("*", csrf({ origin: allowedOrigins }));
}

// --- CORS ---
app.use(
    "*",
    cors({
        origin: isDev ? "*" : allowedOrigins,
        allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allowHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
        exposeHeaders: ["X-Request-Id"],
        credentials: env.CORS_CREDENTIALS && !isDev,
        maxAge: 86400,
    }),
);

// --- Timeout ---
app.use("*", timeout(env.TIMEOUT_MS));

// --- Rate Limiting ---
app.use(
    "*",
    rateLimiter({
        windowMs: env.RATE_LIMIT_WINDOW_MS,
        limit: env.RATE_LIMIT_MAX,
        keyGenerator: (c) => c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown",
    }),
);

// --- Logging ---
app.use("*", logger());

// --- Public routes (no auth required) ---
app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

// --- Routes ---
app.route("/api", appRoutes);

// ─── RFC 7807 Error Handling ──────────────────────────────────────────────────

app.onError((err, c) => {
    if (err instanceof AppError) {
        return sendError(c, err);
    }

    if (err instanceof HTTPException) {
        return sendErrorRaw(
            c,
            err.message || "Request failed",
            err.status as ErrorStatus,
            c.req.path,
        );
    }

    console.error("[Unhandled]", err);
    return sendErrorRaw(c, "An unexpected error occurred", 500, c.req.path);
});

app.notFound((c) =>
    sendErrorRaw(c, `Route ${c.req.method} ${c.req.path} not found`, 404, c.req.path),
);
