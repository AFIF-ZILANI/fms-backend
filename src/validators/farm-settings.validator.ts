import { z } from "zod";

export const updateFarmSettingsSchema = z.object({
    // Past 06:00 a stored date (midnight UTC = 06:00 Dhaka) would slip to the day before; see farm-day.ts.
    day_start_hour: z.coerce.number().int().min(0).max(6, "The farm day must start between midnight and 06:00"),
});

export type UpdateFarmSettingsInput = z.infer<typeof updateFarmSettingsSchema>;
