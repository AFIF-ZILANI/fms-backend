import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { DeviceService } from "./device.service";

let profileId: string;

describe("DeviceService", () => {
    beforeAll(async () => {
        const profile = await prisma.profiles.create({
            data: {
                name: "Device Test Operator",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "ADMIN",
            },
        });
        profileId = profile.id;
    });

    afterAll(async () => {
        // Delete by profile, not only by tracked id: a test that fails midway
        // must not leave rows behind in the shared dev database.
        await prisma.device.deleteMany({ where: { profile_id: profileId } });
        await prisma.pairingCode.deleteMany({ where: { profile_id: profileId } });
        await prisma.profiles.deleteMany({ where: { id: profileId } });
    });

    test("a pairing code redeems exactly once", async () => {
        const { code } = await DeviceService.createPairingCode(profileId);

        const paired = await DeviceService.redeemPairingCode(code, "Rashed's phone", "android");
        expect(paired.token.length).toBeGreaterThan(20);
        expect(paired.profile.id).toBe(profileId);

        await expect(
            DeviceService.redeemPairingCode(code, "Second phone", "android"),
        ).rejects.toThrow("Pairing code");
    });

    test("an expired pairing code is refused", async () => {
        const { code } = await DeviceService.createPairingCode(profileId);
        await prisma.pairingCode.update({
            where: { code },
            data: { expires_at: new Date(Date.now() - 1000) },
        });

        await expect(
            DeviceService.redeemPairingCode(code, "Late phone", "android"),
        ).rejects.toThrow("Pairing code");
    });

    test("resolveToken accepts a live token and refuses a revoked one", async () => {
        const { code } = await DeviceService.createPairingCode(profileId);
        const paired = await DeviceService.redeemPairingCode(code, "Token phone", "ios");

        const resolved = await DeviceService.resolveToken(paired.token);
        expect(resolved?.profile_id).toBe(profileId);
        expect(resolved?.device_id).toBe(paired.device_id);

        await DeviceService.revoke(paired.device_id);
        expect(await DeviceService.resolveToken(paired.token)).toBeNull();
    });

    test("resolveToken refuses a token that was never issued", async () => {
        expect(await DeviceService.resolveToken("not-a-real-token")).toBeNull();
    });
});
