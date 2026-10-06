// Helpers for tests that write to the shared dev database. Not imported by app code.
import prisma from "@lib/db";

/** A house number that won't collide with a real house or another test's: numbers are unique per type. */
export const houseNumber = () => 1_000_000 + Math.floor(Math.random() * 1_000_000_000);

const SHARED_WAREHOUSE = "Shared Test Warehouse";

/** One long-lived warehouse for fixtures that only need *a* warehouse (every purchase has one). Created on
 * first use and deliberately never deleted, so concurrent tests can't pull it out from under each other. */
export async function sharedWarehouseId(): Promise<string> {
    const existing = await prisma.warehouses.findFirst({ where: { name: SHARED_WAREHOUSE }, select: { id: true } });
    if (existing) return existing.id;
    try {
        return (await prisma.warehouses.create({ data: { name: SHARED_WAREHOUSE } })).id;
    } catch {
        // Two test files raced to create it; take the winner's.
        return (await prisma.warehouses.findFirstOrThrow({ where: { name: SHARED_WAREHOUSE }, select: { id: true } })).id;
    }
}
