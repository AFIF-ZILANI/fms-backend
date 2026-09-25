import { Prisma } from "../../prisma/generated/prisma/client";

/**
 * A house that just lost its last bird goes straight into CLEANING, so the
 * turnaround shows on the houses board without anyone remembering to set it.
 *
 * Only READY houses move -- a phase an operator picked themselves
 * (MAINTENANCE, RESTING, ...) is never overwritten. Call this inside the same
 * transaction as whatever decremented the balance, after the decrement.
 */
export async function markEmptiedHousesCleaning(
    tx: Prisma.TransactionClient,
    houseIds: (string | null | undefined)[],
): Promise<void> {
    const ids = [...new Set(houseIds.filter((id): id is string => !!id))];
    if (ids.length === 0) return;

    const occupied = await tx.batchHouseBalance.findMany({
        where: { house_id: { in: ids }, quantity: { gt: 0 } },
        select: { house_id: true },
    });
    const stillOccupied = new Set(occupied.map((b) => b.house_id));
    const emptied = ids.filter((id) => !stillOccupied.has(id));
    if (emptied.length === 0) return;

    await tx.houses.updateMany({
        where: { id: { in: emptied }, phase: "READY" },
        data: { phase: "CLEANING" },
    });
}
