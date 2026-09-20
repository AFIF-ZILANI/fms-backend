import { randomBytes, createHash } from "node:crypto";
import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";

export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

// No I, O, 0 or 1 -- this gets read off a screen and typed on a phone in a shed.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newCode(): string {
    const bytes = randomBytes(8);
    return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

/** Tokens are stored hashed: a database leak must not hand out working devices. */
function hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

export const DeviceService = {
    async createPairingCode(profile_id: string) {
        try {
            const created = await prisma.pairingCode.create({
                data: {
                    code: newCode(),
                    profile_id,
                    expires_at: new Date(Date.now() + PAIRING_CODE_TTL_MS),
                },
            });
            return { code: created.code, expires_at: created.expires_at };
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    /** Single-use: the code is marked used in the same transaction that creates
     * the device, so two phones racing the same code cannot both pair. */
    async redeemPairingCode(code: string, label: string, platform?: string) {
        try {
            return await prisma.$transaction(async (tx) => {
                const pairing = await tx.pairingCode.findUnique({
                    where: { code },
                    include: { profile: { select: { id: true, name: true } } },
                });
                if (!pairing || pairing.used_at || pairing.expires_at < new Date()) {
                    throw AppError.badRequest("Pairing code is invalid, used or expired");
                }

                const token = randomBytes(32).toString("base64url");
                const device = await tx.device.create({
                    data: {
                        profile_id: pairing.profile_id,
                        label,
                        token_hash: hashToken(token),
                        ...(platform !== undefined && { platform }),
                    },
                });
                await tx.pairingCode.update({
                    where: { code },
                    data: { used_at: new Date() },
                });

                return {
                    token,
                    device_id: device.id,
                    profile: { id: pairing.profile.id, name: pairing.profile.name },
                };
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    /** Returns null rather than throwing: the caller is middleware that turns
     * any falsy result into one 401, with no detail about which check failed. */
    async resolveToken(token: string) {
        if (!token) return null;
        const device = await prisma.device.findUnique({
            where: { token_hash: hashToken(token) },
            select: { id: true, profile_id: true, revoked_at: true },
        });
        if (!device || device.revoked_at) return null;

        await prisma.device.update({
            where: { id: device.id },
            data: { last_seen_at: new Date() },
        });
        return { device_id: device.id, profile_id: device.profile_id };
    },

    async listDevices() {
        return prisma.device.findMany({
            orderBy: { created_at: "desc" },
            include: { profile: { select: { id: true, name: true } } },
        });
    },

    async revoke(id: string) {
        const device = await prisma.device.findUnique({ where: { id } });
        if (!device) throw AppError.notFound("Device");
        return prisma.device.update({ where: { id }, data: { revoked_at: new Date() } });
    },
};
