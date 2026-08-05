import { z } from "zod";

// ─── Schema ───────────────────────────────────────────────────────────────────

const envSchema = z.object({
    // ── Server ──────────────────────────────────────────────────────────────
    PORT: z.coerce.number().default(5085),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

    // ── Database ────────────────────────────────────────────────────────────
    DATABASE_URL: z
        .string()
        .min(1, "DATABASE_URL is required")
        .default("postgresql://postgres:postgres@localhost:5432/bhaze"),

    // ── CORS ────────────────────────────────────────────────────────────────
    ALLOWED_ORIGINS: z.string().default("http://localhost:5085,http://localhost:5173"),
    CORS_CREDENTIALS: z
        .string()
        .default("true")
        .transform((v) => v === "true"),

    // ── Rate Limiting ───────────────────────────────────────────────────────
    RATE_LIMIT_MAX: z.coerce.number().default(120),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),

    // ── Security ────────────────────────────────────────────────────────────
    TIMEOUT_MS: z.coerce.number().default(30_000),
    CSRF_ENABLED: z
        .string()
        .default("true")
        .transform((v) => v === "true"),
});

// ─── Parse & Validate ─────────────────────────────────────────────────────────

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
    console.error("❌ Invalid environment variables:");
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
}

// ─── Export ────────────────────────────────────────────────────────────────────

const env = parsed.data;

export type Env = z.infer<typeof envSchema>;

export default env;
