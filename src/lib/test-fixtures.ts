// Helpers for tests that write to the shared dev database. Not imported by app code.
import prisma from "@lib/db";
import type { Prisma } from "../../prisma/generated/prisma/client";

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

/**
 * Deletes audit rows. The log is append-only at the database (a trigger), so test cleanup has to opt in:
 * the flag is set for this one transaction only, never by app code.
 */
export async function purgeAuditLog(args: Prisma.AuditLogDeleteManyArgs) {
    const [, result] = await prisma.$transaction([
        prisma.$executeRaw`SELECT set_config('app.allow_audit_purge', 'on', true)`,
        prisma.auditLog.deleteMany(args),
    ]);
    return result;
}

const SHARED_WALLET = "Shared Test Wallet";

/** One long-lived account for fixtures that record money paid at creation (which must name an account). Created
 * on first use and never deleted, for the same reason as the shared warehouse. */
export async function sharedInstrumentId(): Promise<string> {
    const find = () => prisma.paymentInstrument.findFirst({ where: { label: SHARED_WALLET }, select: { id: true } });
    const existing = await find();
    if (existing) return existing.id;
    try {
        return (
            await prisma.paymentInstrument.create({
                data: { owner_type: "ADMIN", owner_id: crypto.randomUUID(), type: "CASH", label: SHARED_WALLET },
            })
        ).id;
    } catch {
        return (await find())!.id;
    }
}
