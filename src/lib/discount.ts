import { z } from "zod";
import { Prisma } from "../../prisma/generated/prisma/client";
import { AppError } from "@lib/app-error";

/** Discounts, shared by purchases and sales: FLAT is a currency amount, PERCENT is 0-100 of what it discounts. */
export const discountTypeSchema = z.enum(["FLAT", "PERCENT"]);
export type DiscountType = z.infer<typeof discountTypeSchema>;

// discount_type and discount_value travel together -- a lone type with no value (or vice versa)
// is ambiguous, so both-or-neither is enforced here rather than left to the service layer.
export const discountFields = {
    discount_type: discountTypeSchema.optional(),
    discount_value: z.coerce.number().nonnegative().optional(),
};
export const discountRefine = <
    T extends {
        discount_type?: "FLAT" | "PERCENT" | undefined;
        discount_value?: number | undefined;
    },
>(
    data: T,
) => (data.discount_type === undefined) === (data.discount_value === undefined);
export const discountRefineMessage = {
    message: "discount_type and discount_value must be given together",
    path: ["discount_value"],
};

/** The amount a discount takes off `gross`.
 * Rejects a discount that would take the net below zero (a flat discount bigger than the amount
 * it discounts, or a percent over 100) rather than silently clamping to zero. */
export function computeDiscount(
    gross: Prisma.Decimal,
    discount_type: DiscountType | undefined,
    discount_value: number | undefined,
    label: string,
): Prisma.Decimal {
    if (discount_type === undefined) return new Prisma.Decimal(0);
    if (discount_type === "PERCENT") {
        if (discount_value! > 100) {
            throw AppError.badRequest(`${label} discount percent cannot exceed 100`);
        }
        return gross.times(discount_value!).dividedBy(100);
    }
    const flat = new Prisma.Decimal(discount_value!);
    if (flat.greaterThan(gross)) {
        throw AppError.badRequest(`${label} discount cannot exceed the amount it discounts`);
    }
    return flat;
}
