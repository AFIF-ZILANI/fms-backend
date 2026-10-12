import { z } from "zod";

/** The house's stock activity, summarised. The caller's own "today" and "this week" starts decide the windows. */
export const stockActivitySummaryQuerySchema = z.object({
    house_id: z.string().uuid(),
    today_from: z.coerce.date(),
    week_from: z.coerce.date(),
});

export type StockActivitySummaryQuery = z.infer<typeof stockActivitySummaryQuerySchema>;

export type StockActivitySummary = {
    total: number;
    today: number;
    week: number;
    /** Distinct items involved. */
    items: number;
    last_at: Date | null;
};
