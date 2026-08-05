import type { Env } from "hono";

export type AppVariables = {
    validatedBody: unknown;
};

export type AppEnv = Env & { Variables: AppVariables };
