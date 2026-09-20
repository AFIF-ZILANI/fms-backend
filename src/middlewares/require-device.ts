import type { Context, Next } from "hono";
import { AppError } from "@lib/app-error";
import { DeviceService } from "@services/device.service";
import type { DeviceContext } from "../types/app";

/** Guards every route a paired phone can reach. Deliberately says nothing about
 * why a token failed -- unknown, revoked and malformed are one 401. */
export async function requireDevice(c: Context, next: Next) {
    const header = c.req.header("Authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const device = await DeviceService.resolveToken(token);
    if (!device) throw AppError.unauthorized("Device token is missing, invalid or revoked");
    c.set("device", device);
    await next();
}

export function getDevice(c: Context): DeviceContext {
    const device = c.get("device") as DeviceContext | undefined;
    if (!device) throw AppError.internal("requireDevice did not run on this route");
    return device;
}
