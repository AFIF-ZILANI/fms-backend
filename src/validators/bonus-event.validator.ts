import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

export const RELIGIONS = ["ISLAM", "HINDU", "CHRISTIANITY", "BUDDHISM", "OTHER"] as const;

export const createBonusEventSchema = z.object({
    name: z.string().trim().min(1, "Name is required"),
    event_date: z.coerce.date(),
    // Omit for a farm-wide bonus (good harvest, one-off) that isn't a religious festival.
    religion: z.enum(RELIGIONS).nullable().optional(),
    // × the employee's reference salary; 1 = one month's R.
    multiplier: z.coerce.number().positive("Multiplier must be positive").max(24, "Multiplier is too large"),
    min_service_months: z.coerce.number().int().min(0).max(120).default(12),
    prorate: z.boolean().default(true),
});

export const listBonusEventsQuerySchema = paginationQuerySchema;

/** The owner may adjust an amount before confirming, so it is accepted here; the salary and
 * service months snapshotted beside it are always computed by the server. */
export const grantBonusesSchema = z.object({
    bonuses: z
        .array(
            z.object({
                employee_id: z.string().uuid(),
                amount: z.coerce.number().positive("Amount must be positive"),
                note: z.string().trim().min(1).optional(),
            }),
        )
        .min(1, "Select at least one employee"),
});

export type CreateBonusEventInput = z.infer<typeof createBonusEventSchema>;
export type ListBonusEventsQuery = z.infer<typeof listBonusEventsQuerySchema>;
export type GrantBonusesInput = z.infer<typeof grantBonusesSchema>;
