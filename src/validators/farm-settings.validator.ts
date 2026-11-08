import { z } from "zod";

export const updateFarmSettingsSchema = z.object({
    // Past 06:00 a stored date (midnight UTC = 06:00 Dhaka) would slip to the day before; see farm-day.ts.
    day_start_hour: z.coerce
        .number()
        .int()
        .min(0)
        .max(6, "The farm day must start between midnight and 06:00")
        .optional(),
    // Days a sold batch stays open for late costs/income before it is finalised.
    settlement_days: z.coerce.number().int().min(0).max(60, "Keep the settlement window to 60 days or less").optional(),
});

export type UpdateFarmSettingsInput = z.infer<typeof updateFarmSettingsSchema>;
