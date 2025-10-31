/**
 * Represents a custom application error with an HTTP status code and optional data.
 *
 * @remarks
 * This class extends the native `Error` object to include additional properties
 * such as `statusCode` for HTTP error handling and `data` for passing extra error details.
 *
 * @example
 * ```typescript
 * throw new AppError('Resource not found', 404, { resource: 'User' });
 * ```
 *
 * @extends Error
 */
export class AppError extends Error {
    statusCode: number;
    data: any;

    constructor(message: string, statusCode: number = 500, data: any = null) {
        super(message);
        this.statusCode = statusCode;
        this.data = data;
        Error.captureStackTrace(this, this.constructor);
    }
}

// Helper function so you can throw easily
export function throwError({
    message,
    statusCode = 500,
    data = null,
}: {
    message: string;
    statusCode?: number;
    data?: any;
}): never {
    throw new AppError(message, statusCode, data);
}