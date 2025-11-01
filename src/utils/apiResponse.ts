/**
 * Send a standardized **successful API response**.
 *
 * This utility ensures consistent structure for all success responses
 * across your API — improving maintainability, readability, and front-end predictability.
 *
 * ✅ **Usage Example:**
 * ```ts
 * sendSuccessResponse({
 *   response,
 *   message: "Operation successful",
 *   data: result,
 *   statusCode: 201
 * });
 * ```
 *
 * ✅ **Standard Response Format:**
 * ```json
 * {
 *   "success": true,
 *   "message": "Operation successful",
 *   "data": { ... }
 * }
 * ```
 *
 * @param {object} options - Configuration object.
 * @param {Response} options.response - Express response object.
 * @param {string} [options.message] - Optional message describing the result.
 * @param {any} [options.data=null] - Optional response payload (default: null).
 * @param {number} [options.statusCode=200] - HTTP status code (default: 200).
 *
 * @returns {Response} Express JSON response with `{ success, message, data }` structure.
 */
export function sendSuccessResponse({
    response,
    message,
    data = null,
    statusCode = 200,
}: {
    response: import("express").Response;
    message?: string;
    data?: any;
    statusCode?: number;
}) {
    return response.status(statusCode).json({
        success: true,
        message,
        data,
    });
}
