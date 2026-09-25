import { createHash } from "node:crypto";
import env from "@config/env";

/**
 * Cloudinary's signed-upload rule: take every upload parameter except `file`,
 * `api_key` and `resource_type`, sort by key, join as `k=v&k=v`, append the API
 * secret, SHA-1 it. The secret never leaves this process -- the browser gets
 * only the digest and POSTs the file straight to Cloudinary.
 *
 * @see https://cloudinary.com/documentation/signatures
 */
export function signUploadParams(params: Record<string, string | number>): string {
    const toSign = Object.keys(params)
        .sort()
        .map((k) => `${k}=${params[k]}`)
        .join("&");
    return createHash("sha1")
        .update(toSign + env.CLOUDINARY_API_SECRET)
        .digest("hex");
}

export type UploadSignature = {
    cloud_name: string;
    api_key: string;
    timestamp: number;
    folder: string;
    upload_preset: string;
    signature: string;
};

/** Everything the browser needs for one direct-to-Cloudinary upload. */
export function buildUploadSignature(folder: string): UploadSignature {
    const signed = {
        folder,
        timestamp: Math.floor(Date.now() / 1000),
        upload_preset: env.CLOUDINARY_EMPLOYEE_PRESET,
    };
    return {
        cloud_name: env.CLOUDINARY_CLOUD_NAME,
        api_key: env.CLOUDINARY_API_KEY,
        ...signed,
        signature: signUploadParams(signed),
    };
}
