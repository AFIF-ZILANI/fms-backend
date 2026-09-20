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

/** Everything the phone could not know, supplied by the reviewer. The weight and
 * katha figures are pre-filled from the payload in the UI but stay editable:
 * the crate->katha and deduction->dholta mappings are assumptions, and a human
 * has to be able to correct them. */
export const confirmIngestedSchema = z.object({
    batch_id: z.string().uuid(),
    house_id: z.string().uuid(),
    customer_id: z.string().uuid().optional(),
    grade: z.enum(["HIGH", "LOW", "CULL"]),
    birds_count: z.coerce.number().int().positive(),
    male_count: z.coerce.number().int().nonnegative().optional(),
    female_count: z.coerce.number().int().nonnegative().optional(),
    dholta_in_g: z.coerce.number().nonnegative(),
    total_katha: z.coerce.number().int().nonnegative(),
    avg_wt_per_katha_kg: z.coerce.number().positive().optional(),
    total_weight: z.coerce.number().positive(),
    net_weight: z.coerce.number().positive(),
    avg_weight_g: z.coerce.number().positive().optional(),
    price_per_kg: z.coerce.number().positive(),
    paid_amount: z.coerce.number().nonnegative().default(0),
    discount_amount: z.coerce.number().nonnegative().default(0),
});

export const dismissIngestedSchema = z.object({
    reason: z.string().min(1).max(500),
});

export type ConfirmIngestedInput = z.infer<typeof confirmIngestedSchema> & { reviewed_by_id: string };
export type DismissIngestedInput = z.infer<typeof dismissIngestedSchema> & { reviewed_by_id: string };
