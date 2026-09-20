import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess } from "@lib/response";
import { getValid } from "@lib/valid";
import { DeviceService } from "@services/device.service";
import type {
    CreatePairingCodeInput,
    RedeemPairingInput,
} from "@validators/device.validator";

export const DeviceController = {
    async createPairingCode(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<CreatePairingCodeInput>(c, "json");
            const code = await DeviceService.createPairingCode(body.profile_id);
            return sendSuccess(c, code, "Pairing code created", 201);
        });
    },

    async redeemPairingCode(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<RedeemPairingInput>(c, "json");
            const paired = await DeviceService.redeemPairingCode(
                body.code,
                body.device_label,
                body.platform,
            );
            return sendSuccess(c, paired, "Device paired", 201);
        });
    },

    async getAll(c: Context) {
        return withHandler(c, async () => {
            const devices = await DeviceService.listDevices();
            return sendSuccess(c, devices, "Devices fetched successfully");
        });
    },

    async revoke(c: Context) {
        return withHandler(c, async () => {
            const device = await DeviceService.revoke(c.req.param("id") ?? "");
            return sendSuccess(c, device, "Device revoked");
        });
    },
};
