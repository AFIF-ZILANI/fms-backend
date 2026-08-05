import type { Context } from "hono";
import { AppError } from "./app-error";
import type { ErrorStatus, ProblemDetails } from "./app-error";
import type { ContentfulStatusCode } from "hono/utils/http-status";

// ─── Response Contract Types ──────────────────────────────────────────────────

export type Meta = {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
};

export type SuccessResponse<T> = {
    success: true;
    message: string;
    data: T;
    meta?: Meta;
};

/**
 * RFC 7807 Problem Details for HTTP APIs.
 * @see https://www.rfc-editor.org/rfc/rfc7807
 */
export type { ProblemDetails };

export type ApiResponse<T> = SuccessResponse<T> | ProblemDetails;

// ─── Success ──────────────────────────────────────────────────────────────────

export const sendSuccess = <T>(
    c: Context,
    data: T,
    message = "Success",
    status: 200 | 201 | 204 = 200,
    meta?: Meta,
): Response => {
    const body: SuccessResponse<T> = { success: true, message, data };
    if (meta) body.meta = meta;
    return c.json(body, status as ContentfulStatusCode);
};

export const sendList = <T>(
    c: Context,
    data: T[],
    meta: Meta,
    message = "Fetched successfully",
): Response => sendSuccess(c, data, message, 200, meta);

export const sendNoContent = (): Response => new Response(null, { status: 204 });

// ─── Error (RFC 7807) ────────────────────────────────────────────────────────

/**
 * Send an RFC 7807 Problem Details response from an AppError.
 *
 * @example
 *   throw AppError.notFound("User", "/api/users/123");
 *   // → caught by withHandler → sendError(c, err)
 */
export const sendError = (c: Context, error: AppError): Response => {
    const body = error.toProblemDetails();
    return c.json(body, error.status as ContentfulStatusCode);
};

/**
 * Send an RFC 7807 Problem Details response from raw values.
 *
 * @example
 *   return sendErrorRaw(c, "Route not found", 404, "/api/unknown");
 */
export const sendErrorRaw = (
    c: Context,
    detail: string,
    status: ErrorStatus = 500,
    instance?: string,
    extensions?: Record<string, unknown>,
): Response => {
    const opts: {
        message: string;
        status: ErrorStatus;
        detail: string;
        instance?: string;
        extensions?: Record<string, unknown>;
    } = {
        message: detail,
        status,
        detail,
    };
    if (instance !== undefined) opts.instance = instance;
    if (extensions !== undefined) opts.extensions = extensions;
    const err = new AppError(opts);
    return sendError(c, err);
};
