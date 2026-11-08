import prisma from "@lib/db";
import { audit } from "@lib/audit";
import { getDayStartHour, setDayStartHour } from "@lib/farm-day";
import type { UpdateFarmSettingsInput } from "@validators/farm-settings.validator";

// Held in memory next to the day-start hour; loaded at boot, replaced on save.
let settlementDays = 7;
export const getSettlementDays = (): number => settlementDays;

export const FarmSettingsService = {
    get() {
        return { day_start_hour: getDayStartHour(), settlement_days: settlementDays };
    },

    /** Read the stored settings into memory; called once at boot. The row is seeded by its migration. */
    async load() {
        const row = await prisma.farmSettings.findUnique({ where: { id: 1 } });
        if (row) {
            setDayStartHour(row.day_start_hour);
            settlementDays = row.settlement_days;
        }
    },

    async update(data: UpdateFarmSettingsInput, actorId: string) {
        const before = this.get();
        const changes = {
            ...(data.day_start_hour !== undefined && { day_start_hour: data.day_start_hour }),
            ...(data.settlement_days !== undefined && { settlement_days: data.settlement_days }),
        };
        const notes = [
            data.day_start_hour !== undefined &&
                data.day_start_hour !== before.day_start_hour &&
                `Farm day start changed from ${before.day_start_hour}:00 to ${data.day_start_hour}:00`,
            data.settlement_days !== undefined &&
                data.settlement_days !== before.settlement_days &&
                `Settlement window changed from ${before.settlement_days} to ${data.settlement_days} days`,
        ].filter(Boolean);
        const [row] = await prisma.$transaction([
            prisma.farmSettings.upsert({ where: { id: 1 }, create: { id: 1, ...changes }, update: changes }),
            audit(prisma, {
                table: "FarmSettings",
                record_id: "1",
                action: "UPDATE",
                actor_id: actorId,
                note: notes.join("; ") || "Farm settings saved",
                before,
                after: changes,
            }),
        ]);
        setDayStartHour(row.day_start_hour);
        settlementDays = row.settlement_days;
        return { day_start_hour: row.day_start_hour, settlement_days: row.settlement_days };
    },
};
