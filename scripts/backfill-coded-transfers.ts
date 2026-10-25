// Before relocate() posted a transfer, moving a QR-coded unit changed only where it was, not the
// stock ledger -- so units scanned into a house still counted as warehouse stock. This posts the
// missing transfer for every such move, in order, dated when the move happened. Safe to re-run: a
// move that already has its transfer is skipped.
//   bun scripts/backfill-coded-transfers.ts           # dry run -- prints what it would do, writes nothing
//   bun scripts/backfill-coded-transfers.ts --apply
import prisma from "../src/lib/db";
import { StockLedgerService } from "../src/services/stock-ledger.service";
import { lockLot, unitAmount } from "../src/lib/coded-stock";

const apply = process.argv.includes("--apply");
const DRY_RUN = new Error("dry run");

const moves = await prisma.stockHouseAllocation.findMany({
    where: { stock_transfer_id: null },
    orderBy: { occurred_at: "asc" },
    include: {
        house: { select: { name: true } },
        stock_unit: {
            include: {
                purchase_item: {
                    include: {
                        item: { select: { name: true, unit: true, category: true } },
                        purchase: { select: { warehouse_id: true, recorded_by_id: true } },
                    },
                },
            },
        },
    },
});

try {
    await prisma.$transaction(
        async (tx) => {
            let posted = 0;
            for (const move of moves) {
                const lot = move.stock_unit.purchase_item;
                if (!lot) continue;
                // Where the unit was just before this move: the previous move's house, else the warehouse.
                const prev = await tx.stockHouseAllocation.findFirst({
                    where: { stock_unit_id: move.stock_unit_id, occurred_at: { lt: move.occurred_at } },
                    orderBy: { occurred_at: "desc" },
                    select: { house_id: true },
                });
                const at = (house_id: string | null | undefined) =>
                    house_id
                        ? { location_type: "HOUSE" as const, location_id: house_id }
                        : { location_type: "WAREHOUSE" as const, location_id: lot.purchase.warehouse_id };
                const from = at(prev?.house_id);
                const to = at(move.house_id);

                await lockLot(tx, lot.id);
                const amount = await unitAmount(tx, move.stock_unit_id, lot);
                const label = `${lot.item.name} …${move.stock_unit_id.slice(-7)} -> ${move.house?.name ?? "warehouse"}: ${amount} ${lot.item.unit.toLowerCase()}`;
                if (!amount.greaterThan(0)) {
                    console.log(`skip  ${label} (nothing left in it)`);
                    continue;
                }

                const transfer = await tx.stockTransfer.create({
                    data: {
                        item_id: lot.item_id,
                        from_location_type: from.location_type,
                        from_location_id: from.location_id,
                        to_location_type: to.location_type,
                        to_location_id: to.location_id,
                        quantity: amount,
                        unit: lot.item.unit,
                        base_quantity: amount,
                        note: "Coded unit moved (backfilled)",
                        recorded_by_id: lot.purchase.recorded_by_id,
                        idempotency_key: `${move.idempotency_key}:transfer`,
                        created_at: move.occurred_at,
                    },
                });
                for (const [direction, loc] of [
                    ["OUT", from],
                    ["IN", to],
                ] as const) {
                    await StockLedgerService.record(tx, {
                        item_id: lot.item_id,
                        quantity: amount,
                        direction,
                        reason: "TRANSFER",
                        ref_type: "TRANSFER",
                        ref_id: transfer.id,
                        ...loc,
                    });
                }
                await tx.stockLedger.updateMany({
                    where: { ref_type: "TRANSFER", ref_id: transfer.id },
                    data: { occurred_at: move.occurred_at },
                });
                await tx.stockHouseAllocation.update({
                    where: { id: move.id },
                    data: { stock_transfer_id: transfer.id },
                });
                posted++;
                console.log(`move  ${label}`);
            }
            console.log(`\n${posted} transfer(s) ${apply ? "posted" : "would be posted (dry run, nothing written)"}`);
            if (!apply) throw DRY_RUN;
        },
        { timeout: 120_000 },
    );
} catch (err) {
    if (err !== DRY_RUN) throw err;
}
process.exit(0);
