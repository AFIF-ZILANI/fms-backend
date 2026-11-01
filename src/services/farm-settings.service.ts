import prisma from "@lib/db";
import { audit } from "@lib/audit";
import { getDayStartHour, setDayStartHour } from "@lib/farm-day";
import type { UpdateFarmSettingsInput } from "@validators/farm-settings.validator";

export const FarmSettingsService = {
    get() {
        return { day_start_hour: getDayStartHour() };
    },

    /** Read the stored settings into memory; called once at boot. The row is seeded by its migration. */
    async load() {
        const row = await prisma.farmSettings.findUnique({ where: { id: 1 } });
        if (row) setDayStartHour(row.day_start_hour);
    },

    async update(data: UpdateFarmSettingsInput, actorId: string) {
        const before = getDayStartHour();
        const [row] = await prisma.$transaction([
            prisma.farmSettings.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data }),
            audit(prisma, {
                table: "FarmSettings",
                record_id: "1",
                action: "UPDATE",
                actor_id: actorId,
                note: `Farm day start changed from ${before}:00 to ${data.day_start_hour}:00`,
                before: { day_start_hour: before },
                after: data,
            }),
        ]);
        setDayStartHour(row.day_start_hour);
        return { day_start_hour: row.day_start_hour };
    },
};
