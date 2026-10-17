// Helpers for tests that write to the shared dev database. Not imported by app code.
import prisma from "@lib/db";
import type { Prisma } from "../../prisma/generated/prisma/client";

/** A house number that won't collide with a real house or another test's: numbers are unique per type. */
export const houseNumber = () => 1_000_000 + Math.floor(Math.random() * 1_000_000_000);

const SHARED_WAREHOUSE = "Shared Test Warehouse";

/** One long-lived warehouse for fixtures that only need *a* warehouse (every purchase has one). Created on
 * first use and deliberately never deleted, so concurrent tests can't pull it out from under each other. */
export async function sharedWarehouseId(): Promise<string> {
    const existing = await prisma.warehouses.findFirst({
        where: { name: SHARED_WAREHOUSE },
        select: { id: true },
    });
    if (existing) return existing.id;
    try {
        return (await prisma.warehouses.create({ data: { name: SHARED_WAREHOUSE } })).id;
    } catch {
        // Two test files raced to create it; take the winner's.
        return (
            await prisma.warehouses.findFirstOrThrow({
                where: { name: SHARED_WAREHOUSE },
                select: { id: true },
            })
        ).id;
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

/** One account for fixtures that record money paid at creation (which must name an account). Created on first
 * use and shared by every suite in a run; removed once the whole run is done (src/test-setup.ts), so it never
 * sits among the farm's real accounts. */
export async function sharedInstrumentId(): Promise<string> {
    // Active only: an account tidied away in the app is left alone, and paying from it would be refused.
    const find = () =>
        prisma.paymentInstrument.findFirst({
            where: { label: SHARED_WALLET, is_active: true },
            select: { id: true },
        });
    const existing = await find();
    if (existing) return existing.id;
    try {
        return (
            await prisma.paymentInstrument.create({
                data: {
                    type: "CASH",
                    label: SHARED_WALLET,
                },
            })
        ).id;
    } catch {
        return (await find())!.id;
    }
}

/** Drops the shared test account and the payments made through it -- payments the suites' own fixtures
 * didn't already clean up, since the account is only ever used by tests. */
export async function removeSharedTestWallet() {
    const wallets = await prisma.paymentInstrument.findMany({ where: { label: SHARED_WALLET }, select: { id: true } });
    const ids = wallets.map((w) => w.id);
    if (ids.length === 0) return;
    await prisma.payment.deleteMany({
        where: { OR: [{ from_instrument_id: { in: ids } }, { to_instrument_id: { in: ids } }] },
    });
    await prisma.paymentInstrument.deleteMany({ where: { id: { in: ids } } });
}

/** Puts `quantity` of an item into a warehouse's stock (a ledger IN). The caller deletes the item's ledger rows in teardown. */
export async function seedStock(item_id: string, warehouse_id: string, quantity: number) {
    await prisma.stockLedger.create({
        data: {
            item_id,
            quantity,
            direction: "IN",
            reason: "OPENING_BALANCE",
            ref_type: "ADJUSTMENT",
            ref_id: crypto.randomUUID(),
            location_type: "WAREHOUSE",
            location_id: warehouse_id,
            idempotency_key: crypto.randomUUID(),
        },
    });
}

/** A QR unit bound to a one-line lot of its own (a unit-tracked item), ready to relocate or register as
 * an asset. Pair with removeBoundStockUnit in teardown, after deleting anything that points at the unit. */
export async function boundStockUnit(recorded_by_id: string, category = "EQUIPMENT") {
    const item = await prisma.item.create({
        data: {
            name: `Fixture Unit Item ${crypto.randomUUID()}`,
            normalized_key: `fixture unit item ${crypto.randomUUID()}`,
            category,
            unit: "UNIT",
            is_unit_tracked: true,
        },
    });
    const purchase = await prisma.purchase.create({
        data: {
            warehouse_id: await sharedWarehouseId(),
            purchase_date: new Date(),
            total_amount: 1,
            paid_amount: 0,
            due_amount: 1,
            recorded_by_id,
        },
    });
    const lot = await prisma.purchaseItem.create({
        data: {
            purchase_id: purchase.id,
            item_id: item.id,
            quantity: 1,
            unit: "UNIT",
            base_quantity: 1,
            unit_price: 1,
            total_price: 1,
            unit_count: 1,
        },
    });
    const unit = await prisma.stockUnit.create({
        data: { purchase_item_id: lot.id, status: "IN_STOCK", bound_at: new Date() },
    });
    return { unitId: unit.id, itemId: item.id, purchaseId: purchase.id, lotId: lot.id };
}

export async function removeBoundStockUnit(f: Awaited<ReturnType<typeof boundStockUnit>>) {
    await prisma.stockHouseAllocation.deleteMany({ where: { stock_unit_id: f.unitId } });
    await prisma.consumption.deleteMany({ where: { stock_unit_id: f.unitId } });
    await prisma.stockUnit.deleteMany({ where: { id: f.unitId } });
    await prisma.stockLedger.deleteMany({ where: { item_id: f.itemId } });
    await prisma.purchaseItem.deleteMany({ where: { id: f.lotId } });
    await prisma.purchase.deleteMany({ where: { id: f.purchaseId } });
    await prisma.item.deleteMany({ where: { id: f.itemId } });
}
