import { Prisma } from "../../prisma/generated/prisma/client";
import { AppError } from "@lib/app-error";

/**
 * Converts a quantity entered in `unit` to the item's base unit (Item.unit),
 * using that item's ItemUnit conversion factor. Returns the quantity
 * unchanged when `unit` already is the base unit -- no factor row needed
 * for that case. `purpose` restricts the lookup to conversion rows flagged
 * for that flow (a unit purchasable but not usable can't be used to record
 * consumption, and vice versa).
 */
export async function toBaseQuantity(
    tx: Prisma.TransactionClient,
    item_id: string,
    unit: string,
    quantity: Prisma.Decimal | number,
    purpose: "PURCHASE" | "USABLE",
): Promise<Prisma.Decimal> {
    const item = await tx.item.findUnique({ where: { id: item_id }, select: { unit: true } });
    if (!item) throw AppError.badRequest("item_id does not reference an existing record");

    const qty = new Prisma.Decimal(quantity);
    if (unit === item.unit) return qty;

    const conversion = await tx.itemUnit.findUnique({
        where: { item_id_unit: { item_id, unit } },
    });
    const purposeField = purpose === "PURCHASE" ? "is_purchasable" : "is_usable";
    if (!conversion || !conversion[purposeField]) {
        const verb = purpose === "PURCHASE" ? "purchasing" : "using";
        throw AppError.badRequest(
            `"${unit}" is not a valid unit for ${verb} this item -- add or update the conversion via POST /item-units first`,
        );
    }
    return qty.times(conversion.factor_to_base);
}
