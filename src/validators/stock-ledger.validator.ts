import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

export const listStockLedgerQuerySchema = paginationQuerySchema.extend({
    item_id: z.string().uuid().optional(),
    direction: z.enum(["IN", "OUT"]).optional(),
    reason: z
        .enum([
            "PURCHASE",
            "TRANSFER",
            "CONSUMPTION",
            "WASTAGE",
            "EXPIRED",
            "ADJUSTMENT",
            "OPENING_BALANCE",
        ])
        .optional(),
});

export type ListStockLedgerQuery = z.infer<typeof listStockLedgerQuerySchema>;
