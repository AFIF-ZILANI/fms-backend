import { z } from "zod";

// The QR payload is the StockUnit id.
export const scanBottleSchema = z.object({
    stock_unit_id: z.string().uuid(),
});

export type ScanBottleInput = z.infer<typeof scanBottleSchema>;
