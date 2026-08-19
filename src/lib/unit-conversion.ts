import { Prisma } from "../../prisma/generated/prisma/client";
import { AppError } from "@lib/app-error";

/**
 * Converts a quantity entered in `unit` to the item's base unit (Item.unit),
 * using that item's ItemUnit conversion factor. Returns the quantity
 * unchanged when `unit` already is the base unit -- no factor row needed
 * for that case.
 */
export async function toBaseQuantity(
    tx: Prisma.TransactionClient,
    item_id: string,
    unit: string,
    quantity: Prisma.Decimal | number,
): Promise<Prisma.Decimal> {
    const item = await tx.item.findUnique({ where: { id: item_id }, select: { unit: true } });
    if (!item) throw AppError.badRequest("item_id does not reference an existing record");

    const qty = new Prisma.Decimal(quantity);
    if (unit === item.unit) return qty;

    const conversion = await tx.itemUnit.findUnique({
        where: { item_id_unit: { item_id, unit } },
    });
    if (!conversion) {
        throw AppError.badRequest(
            `No conversion factor from "${unit}" to this item's base unit "${item.unit}" -- add one via POST /item-units first`,
        );
    }
    return qty.times(conversion.factor_to_base);
}
