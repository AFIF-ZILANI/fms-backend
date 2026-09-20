import type { Context } from "hono";
import prisma from "@lib/db";
import { AppError } from "@lib/app-error";

let cachedAdminProfileId: string | null = null;

/**
 * The Profile id stamped on every "who did this" column (recorded_by_id,
 * given_by_id, administered_by_id, ...). Never comes from the request body --
 * a client that can name the actor can forge attribution on any record.
 *
 * ponytail: there is no login yet, so the fallback is the oldest Admin's
 * profile. When auth lands, read the session/cookie here and every caller is
 * fixed at once -- nothing else has to change.
 */
export async function getActorId(c: Context): Promise<string> {
    // A paired device already proved an identity (requireDevice); trust it.
    const device = c.get("device") as { profile_id: string } | undefined;
    if (device) return device.profile_id;

    if (cachedAdminProfileId) return cachedAdminProfileId;
    const admin = await prisma.admins.findFirst({
        orderBy: { created_at: "asc" },
        select: { profile_id: true },
    });
    if (!admin) throw AppError.internal("No admin exists to attribute this record to");
    cachedAdminProfileId = admin.profile_id;
    return cachedAdminProfileId;
}
