import { z } from "zod";

export const createPairingCodeSchema = z.object({
    profile_id: z.string().uuid(),
});

export const redeemPairingSchema = z.object({
    code: z.string().min(4).max(16),
    device_label: z.string().min(1).max(80),
    platform: z.string().max(40).optional(),
});

export type CreatePairingCodeInput = z.infer<typeof createPairingCodeSchema>;
export type RedeemPairingInput = z.infer<typeof redeemPairingSchema>;
