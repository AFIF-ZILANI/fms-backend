import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

const timePeriod = z.enum([
    "MORNING",
    "NOON",
    "AFTERNOON",
    "EVENING",
    "NIGHT",
    "MIDNIGHT",
    "LATENIGHT",
]);

export const createEnvironmentRecordSchema = z.object({
    batch_id: z.string().uuid(),
    house_id: z.string().uuid(),
    temperature_c: z.coerce.number(),
    humidity_percent: z.coerce.number(),
    ammonia_ppm: z.coerce.number(),
    co2_ppm: z.coerce.number(),
    air_pressure_hpa: z.coerce.number(),
    time_period: timePeriod,
    recorded_by_id: z.string().uuid(),
    idempotency_key: z.string().min(1).optional(),
});

export const listEnvironmentRecordsQuerySchema = paginationQuerySchema.extend({
    batch_id: z.string().uuid().optional(),
    house_id: z.string().uuid().optional(),
});

export type CreateEnvironmentRecordInput = z.infer<typeof createEnvironmentRecordSchema>;
export type ListEnvironmentRecordsQuery = z.infer<typeof listEnvironmentRecordsQuerySchema>;
