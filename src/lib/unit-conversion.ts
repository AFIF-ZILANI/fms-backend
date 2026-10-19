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
    const item = await tx.item.findUnique({
        where: { id: item_id },
        select: { unit: true, is_active: true, name: true },
    });
    if (!item) throw AppError.badRequest("item_id does not reference an existing record");
    // A deactivated item can still be *purchased* (to settle or restock before reactivating) but takes no
    // new use: consumption, transfers and sales all call this with USABLE.
    if (purpose === "USABLE" && !item.is_active) {
        throw AppError.badRequest(`${item.name} is deactivated -- reactivate it before using it`);
    }

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

/** kg in one of these weight units. */
const KG_PER_UNIT: Record<string, number> = { KG: 1, G: 0.001, MON_40KG: 40, METRIC_TON: 1000 };

/** kg in one base unit of an item, or null when the item has no weight conversion (a BAG item with no
 * KG ItemUnit). factor_to_base is "1 of unit = factor base units", so kg/base = kg/unit / factor. */
export function kgPerBaseUnit(
    baseUnit: string,
    itemUnits: { unit: string; factor_to_base: Prisma.Decimal }[],
) {
    if (KG_PER_UNIT[baseUnit] !== undefined) return KG_PER_UNIT[baseUnit];
    const weighted = itemUnits.find(
        (u) => KG_PER_UNIT[u.unit] !== undefined && !u.factor_to_base.isZero(),
    );
    return weighted ? KG_PER_UNIT[weighted.unit]! / weighted.factor_to_base.toNumber() : null;
}
