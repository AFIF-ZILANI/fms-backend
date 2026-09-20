import { z } from "zod";

/** PoultryScale's own vocabulary, deliberately. Translating on the device would
 * mean shipping FMS concepts into an app that has no OTA update channel. */
export const ingestSaleSchema = z.object({
    sale_id: z.string().min(1), // device-generated UUID, stable across drafts
    batch_id: z.string().min(1).nullable().optional(),
    batch_name: z.string().max(120).nullable().optional(),
    sale_date: z.coerce.date(),
    is_pcs_tracked: z.boolean(),
    has_cull: z.boolean(),

    main: z.object({
        weight_kg: z.number().nonnegative(),
        net_weight_kg: z.number().nonnegative(),
        pcs: z.number().int().nonnegative().nullable().optional(),
        avg_wt_grams: z.number().nonnegative().nullable().optional(),
        price_per_kg: z.number().nonnegative(),
        amount: z.number().nonnegative(),
        total_crates: z.number().nonnegative(),
        deduction_per_crate_g: z.number().nonnegative(),
        total_deduction_wt_kg: z.number().nonnegative(),
        is_full_crates_only: z.boolean(),
    }),

    cull: z
        .object({
            is_sold: z.boolean(),
            weight_kg: z.number().nonnegative(),
            pcs: z.number().int().nonnegative().nullable().optional(),
            sale_type: z.enum(["pcs", "weight"]).nullable().optional(),
            price: z.number().nonnegative().nullable().optional(),
            amount: z.number().nonnegative().nullable().optional(),
        })
        .nullable()
        .optional(),

    buyer_name: z.string().max(120).nullable().optional(),
    buyer_type: z.enum(["wholesaler", "retail", "direct"]).nullable().optional(),
    final_amount: z.number().nonnegative(),
    received_amount: z.number().nonnegative(),
});

export const listIngestedQuerySchema = z.object({
    status: z.enum(["PENDING", "CONFIRMED", "DISMISSED"]).optional(),
});

export type IngestSaleInput = z.infer<typeof ingestSaleSchema>;
export type ListIngestedQuery = z.infer<typeof listIngestedQuerySchema>;
