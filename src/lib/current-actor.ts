import type { Context } from "hono";
import prisma from "@lib/db";
import { AppError } from "@lib/app-error";

let cachedAdminProfileId: string | null = null;

/**
 * The Profile id stamped on every "who did this" column (recorded_by_id,
 * given_by_id, administered_by_id, ...). Never comes from the request body --
 * a client that can name the actor can forge attribution on any record.
 *
 * The logged-in person (authenticate middleware) wins; a paired device
 * (requireDevice) is the only other caller that can reach a controller.
 */
export async function getActorId(c: Context): Promise<string> {
    const auth = c.get("auth") as { profile_id: string } | undefined;
    if (auth) return auth.profile_id;
    const device = c.get("device") as { profile_id: string } | undefined;
    if (device) return device.profile_id;
    throw AppError.unauthorized();
}

/**
 * The oldest Admin's profile, for a service called without a Context -- a test
 * hitting EmployeeService.update() directly, say. Controllers never use this:
 * they go through getActorId, which has a real login behind it.
 */
export async function getDefaultActorId(): Promise<string> {
    if (cachedAdminProfileId) return cachedAdminProfileId;
    const admin = await prisma.admins.findFirst({
        orderBy: { created_at: "asc" },
        select: { profile_id: true },
    });
    if (!admin) throw AppError.internal("No admin exists to attribute this record to");
    cachedAdminProfileId = admin.profile_id;
    return cachedAdminProfileId;
}
