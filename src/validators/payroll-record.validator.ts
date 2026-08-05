import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

export const generatePayrollSchema = z.object({
    employee_id: z.string().uuid(),
    month: z.coerce.date(),
});

export const listPayrollRecordsQuerySchema = paginationQuerySchema.extend({
    employee_id: z.string().uuid().optional(),
});

export type GeneratePayrollInput = z.infer<typeof generatePayrollSchema>;
export type ListPayrollRecordsQuery = z.infer<typeof listPayrollRecordsQuerySchema>;
