/**
 * RFC 7807 — Problem Details for HTTP APIs
 * https://www.rfc-editor.org/rfc/rfc7807
 *
 * The `type` URI identifies the error class. `title` is a short, human-readable
 * summary. `status` is the HTTP status code. `detail` is a one-off explanation.
 * `instance` is a URI reference identifying the specific occurrence.
 */

export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 503;

/** RFC 7807 Problem Details object */
export type ProblemDetails = {
    /** URI reference identifying the problem type */
    type: string;
    /** Short, human-readable summary of the problem type */
    title: string;
    /** HTTP status code */
    status: ErrorStatus;
    /** Human-readable explanation specific to this occurrence */
    detail: string;
    /** URI reference identifying the specific occurrence */
    instance?: string | undefined;
    /** Optional additional data */
    extensions?: Record<string, unknown> | undefined;
};

type AppErrorOptions = {
    message: string;
    status?: ErrorStatus | undefined;
    type?: string | undefined;
    title?: string | undefined;
    detail?: string | undefined;
    instance?: string | undefined;
    extensions?: Record<string, unknown> | undefined;
    cause?: unknown;
};

const ERROR_TYPES: Record<ErrorStatus, { type: string; title: string }> = {
    400: { type: "https://api.bhaze.dev/errors/bad-request", title: "Bad Request" },
    401: { type: "https://api.bhaze.dev/errors/unauthorized", title: "Unauthorized" },
    403: { type: "https://api.bhaze.dev/errors/forbidden", title: "Forbidden" },
    404: { type: "https://api.bhaze.dev/errors/not-found", title: "Not Found" },
    409: { type: "https://api.bhaze.dev/errors/conflict", title: "Conflict" },
    422: { type: "https://api.bhaze.dev/errors/unprocessable", title: "Unprocessable Entity" },
    429: { type: "https://api.bhaze.dev/errors/rate-limited", title: "Too Many Requests" },
    500: { type: "https://api.bhaze.dev/errors/internal", title: "Internal Server Error" },
    503: { type: "https://api.bhaze.dev/errors/unavailable", title: "Service Unavailable" },
};

export class AppError extends Error {
    public readonly status: ErrorStatus;
    public readonly type: string;
    public readonly title: string;
    public readonly detail: string;
    public readonly instance: string | undefined;
    public readonly extensions: Record<string, unknown> | undefined;
    public readonly timestamp: string;

    constructor({
        message,
        status = 400,
        type,
        title,
        detail,
        instance,
        extensions,
        cause,
    }: AppErrorOptions) {
        super(message, { cause });
        this.name = "AppError";
        this.status = status;
        this.type = type ?? ERROR_TYPES[status].type;
        this.title = title ?? ERROR_TYPES[status].title;
        this.detail = detail ?? message;
        this.instance = instance;
        this.extensions = extensions;
        this.timestamp = new Date().toISOString();
        Error.captureStackTrace?.(this, this.constructor);
    }

    /** Convert to RFC 7807 Problem Details object */
    toProblemDetails(): ProblemDetails {
        const problem: ProblemDetails = {
            type: this.type,
            title: this.title,
            status: this.status,
            detail: this.detail,
        };
        if (this.instance) problem.instance = this.instance;
        if (this.extensions && Object.keys(this.extensions).length > 0) {
            problem.extensions = this.extensions;
        }
        return problem;
    }

    // ─── Static factories ─────────────────────────────────────────────────────

    static badRequest(detail: string, extensions?: Record<string, unknown>) {
        return new AppError({
            message: detail,
            status: 400,
            detail,
            ...(extensions !== undefined && { extensions }),
        });
    }

    static unauthorized(detail = "Authentication required") {
        return new AppError({ message: detail, status: 401, detail });
    }

    static forbidden(detail = "Insufficient permissions") {
        return new AppError({ message: detail, status: 403, detail });
    }

    static notFound(resource: string, instance?: string) {
        return new AppError({
            message: `${resource} not found`,
            status: 404,
            detail: `${resource} not found`,
            ...(instance !== undefined && { instance }),
        });
    }

    static conflict(detail: string, extensions?: Record<string, unknown>) {
        return new AppError({
            message: detail,
            status: 409,
            detail,
            ...(extensions !== undefined && { extensions }),
        });
    }

    static unprocessable(detail: string, extensions?: Record<string, unknown>) {
        return new AppError({
            message: detail,
            status: 422,
            detail,
            ...(extensions !== undefined && { extensions }),
        });
    }

    static tooManyRequests(detail = "Rate limit exceeded, try again later") {
        return new AppError({ message: detail, status: 429, detail });
    }

    static internal(detail = "An unexpected error occurred", cause?: unknown) {
        return new AppError({ message: detail, status: 500, detail, cause });
    }

    static serviceUnavailable(detail = "Service temporarily unavailable", cause?: unknown) {
        return new AppError({ message: detail, status: 503, detail, cause });
    }

    /** Create from an HTTPException (Hono) */
    static fromHttp(status: ErrorStatus, detail: string, instance?: string) {
        return new AppError({
            message: detail,
            status,
            detail,
            ...(instance !== undefined && { instance }),
        });
    }

    // ─── Serialise ────────────────────────────────────────────────────────────

    toJSON() {
        return this.toProblemDetails();
    }
}
