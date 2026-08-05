import type { Context } from "hono";
import { AppError } from "./app-error";
import { sendSuccess, sendError } from "./response";

/**
 * Wraps a controller function with automatic error handling.
 *
 * - Returns `sendSuccess(c, data)` on success.
 * - Returns `sendError(c, err)` if an `AppError` is thrown.
 * - Returns `sendError(c, AppError.internal(...))` for unexpected errors.
 */
export const withHandler = <T>(
    c: Context,
    fn: () => Promise<T> | T,
    options?: { message?: string; status?: 200 | 201 | 204 },
): Promise<Response> =>
    Promise.resolve()
        .then(() => fn())
        // fn() may already have built its Response via sendSuccess/sendList
        // (the documented pattern — a custom message/status per call site);
        // only auto-wrap when it returned raw data instead.
        .then((data) =>
            data instanceof Response
                ? data
                : sendSuccess(c, data, options?.message, options?.status ?? 200),
        )
        .catch((err) => {
            if (err instanceof AppError) return sendError(c, err);
            console.error("[Unhandled]", err);
            return sendError(c, AppError.internal(undefined, err));
        });
