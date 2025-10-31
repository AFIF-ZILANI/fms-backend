
/**
 * Utility function to send standardized API responses.
 * Ensures consistent response structure across all API endpoints.
 * Reduces repetitive code in controllers and centralizes response formatting.
 *
 * Usage:
 *   sendResponse({
 *     response,
 *     success: true,
 *     message: "Operation successful",
 *     data: result,
 *     statusCode: 201
 *   });
 *
 * Response format:
 * {
 *   success: boolean,
 *   message?: string,
 *   data?: any
 * }
 */

import type { Response } from "express";

interface ApiResponseOptions {
    response: Response;
    success?: boolean;
    message?: string;
    data?: any;
    statusCode?: number;
}

export function sendSuccessResponse({
    response,
    message,
    data = null,
    statusCode = 200,
}: ApiResponseOptions) {
    return response.status(statusCode).json({
        success: true,
        message,
        data,
    });
}
