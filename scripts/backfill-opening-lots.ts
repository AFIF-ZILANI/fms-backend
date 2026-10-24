// Opening balances recorded for QR-tracked items before opening lots existed have no lot, so their
// codes can't be linked. This gives each one its lot (see createOpeningLot). Safe to re-run: an item
// that already has an opening lot is skipped.
//   bun scripts/backfill-opening-lots.ts           # dry run -- prints what it would do, writes nothing
//   bun scripts/backfill-opening-lots.ts --apply
import prisma from "../src/lib/db";
import { createOpeningLot } from "../src/services/inventory-adjustment.service";

const apply = process.argv.includes("--apply");
const DRY_RUN = new Error("dry run");

const openings = await prisma.inventoryAdjustment.findMany({
    where: { reason: "Opening balance", item: { is_unit_tracked: true } },
    include: { item: { select: { name: true, unit: true } } },
    orderBy: { created_at: "asc" },
});

try {
    await prisma.$transaction(async (tx) => {
        let created = 0;
        for (const a of openings) {
            const label = `${a.item.name} -- ${a.quantity_after} ${a.item.unit.toLowerCase()}`;
            if (!a.warehouse_id) {
                console.log(`skip  ${label}: recorded at a house, needs a warehouse lot -- fix by hand`);
                continue;
            }
            const existing = await tx.purchaseItem.findFirst({
                where: { item_id: a.item_id, purchase: { is_opening: true } },
                select: { id: true },
            });
            if (existing) {
                console.log(`skip  ${label}: already has an opening lot`);
                continue;
            }
            await createOpeningLot(tx, {
                item_id: a.item_id,
                unit: a.item.unit,
                quantity: a.quantity_after,
                warehouse_id: a.warehouse_id,
                recorded_by_id: a.recorded_by_id,
                date: a.created_at,
            });
            created++;
            console.log(`lot   ${label}`);
        }
        console.log(`\n${created} opening lot(s) ${apply ? "created" : "would be created (dry run, nothing written)"}`);
        if (!apply) throw DRY_RUN;
    }, { timeout: 60_000 });
} catch (err) {
    if (err !== DRY_RUN) throw err;
}
process.exit(0);
