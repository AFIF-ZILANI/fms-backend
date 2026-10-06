import type { Prisma } from "../../prisma/generated/prisma/client";
import { AppError } from "@lib/app-error";

/**
 * A deactivated house takes no new activity. "Delete only mistakes" is the rule for removing things;
 * deactivating is how a used house is retired, and this is what makes that mean something. Only a
 * house that exists and is inactive is refused: a missing id keeps the existing "does not reference
 * a real record" handling.
 *
 * Callers choose where it applies. Moving stock or birds OUT of an inactive house is allowed (that is
 * how it gets emptied); putting things into it, or recording work in it, is not.
 */
export async function assertHouseActive(tx: Prisma.TransactionClient, house_id: string) {
    const house = await tx.houses.findUnique({
        where: { id: house_id },
        select: { is_active: true, name: true },
    });
    if (house && !house.is_active) {
        throw AppError.badRequest(`${house.name} is deactivated -- reactivate it before recording anything there`);
    }
}
