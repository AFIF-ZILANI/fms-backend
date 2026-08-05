import type { Context } from "hono";

/**
 * Reads a Hono request-validator result. Routes and controllers live in
 * separate files, so Hono's fluent type inference (which threads validator
 * schemas through `.post(path, validator, handler)` chains on one instance)
 * never reaches the controller — `c.req.valid(target)` types as `never`
 * there. This is the single, explicit, documented escape hatch for that,
 * instead of an `any` cast repeated in every controller.
 */
export const getValid = <T>(c: Context, target: "json" | "query" | "param" | "header"): T =>
    (c.req.valid as (t: typeof target) => unknown)(target) as T;
