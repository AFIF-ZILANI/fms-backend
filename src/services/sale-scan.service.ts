import prisma from "@lib/db";
import type { Prisma } from "../../prisma/generated/prisma/client";
import { AppError } from "@lib/app-error";
import { audit } from "@lib/audit";
import { isNonDepleting, lockLot, unitAmount, unitLocation } from "@lib/coded-stock";
import { lockedUnit } from "@services/stock-unit.service";
import { StockLedgerService } from "@services/stock-ledger.service";

/** Manager-facing: scanning a QR sale's bottles out on the phone. Managers never see money (finance stays the
 *  admin's), so everything here is selected field by field -- no prices, totals, paid or due. */

export type ScanResult = {
    line_id: string;
    item_name: string;
    scanned: number;
    quantity: number;
    sale_done: boolean;
};
type ScanLine = { id: string; item_name: string; quantity: number; scanned: number };
export type ScanSale = {
    id: string;
    sale_date: Date;
    customer_name: string | null;
    lines: ScanLine[];
};
export type ScanSaleDetail = ScanSale & {
    bottles: {
        id: string;
        line_id: string;
        size: string;
        unit: string;
        lot_date: Date;
        sold_by: string | null;
        sold_at: Date;
    }[];
};

const saleSelect = {
    id: true,
    kind: true,
    sale_date: true,
    customer: { select: { profile: { select: { name: true } } } },
    items: {
        select: { id: true, item_id: true, quantity: true, item: { select: { name: true } } },
    },
} satisfies Prisma.SaleSelect;
type SelectedSale = Prisma.SaleGetPayload<{ select: typeof saleSelect }>;

/** The status words a refused scan shows, for statuses with no message of their own. */
const statusWords = (status: string) => status.toLowerCase().replace("_", " ");

/** How many bottles have gone out on each of these sale lines. */
async function scannedByLine(db: Prisma.TransactionClient, lineIds: string[]) {
    const counts = await db.stockUnit.groupBy({
        by: ["sale_item_id"],
        where: { sale_item_id: { in: lineIds } },
        _count: { _all: true },
    });
    return new Map(counts.map((c) => [c.sale_item_id, c._count._all]));
}

async function withCounts(sales: SelectedSale[]) {
    const scanned = await scannedByLine(
        prisma,
        sales.flatMap((s) => s.items.map((l) => l.id)),
    );
    return sales.map(
        (s): ScanSale => ({
            id: s.id,
            sale_date: s.sale_date,
            customer_name: s.customer?.profile.name ?? null,
            lines: s.items.map((l) => ({
                id: l.id,
                item_name: l.item.name,
                quantity: l.quantity.toNumber(),
                scanned: scanned.get(l.id) ?? 0,
            })),
        }),
    );
}

export const SaleScanService = {
    /** One bottle out of a QR sale: it must be sealed, its item on the sale, and that line not yet full. Only now
     *  does stock leave -- the whole bottle, from wherever it is -- and the bottle reads SOLD. */
    async scan(sale_id: string, stock_unit_id: string, actor_id: string): Promise<ScanResult> {
        return prisma.$transaction(async (tx) => {
            const sale = await tx.sale.findUnique({ where: { id: sale_id }, select: saleSelect });
            if (!sale) throw AppError.notFound("Sale");
            if (sale.kind !== "CODED") throw AppError.conflict("This sale isn't for QR items");

            const exists = await tx.stockUnit.findUnique({
                where: { id: stock_unit_id },
                select: { id: true },
            });
            if (!exists) {
                const detail = "This code isn't in the system";
                throw new AppError({ message: detail, status: 404, detail });
            }
            const unit = await lockedUnit(tx, stock_unit_id);
            const progress = async (line: SelectedSale["items"][number]): Promise<ScanResult> => {
                const scanned = await scannedByLine(
                    tx,
                    sale.items.map((l) => l.id),
                );
                return {
                    line_id: line.id,
                    item_name: line.item.name,
                    scanned: scanned.get(line.id) ?? 0,
                    quantity: line.quantity.toNumber(),
                    sale_done: sale.items.every(
                        (l) => (scanned.get(l.id) ?? 0) >= l.quantity.toNumber(),
                    ),
                };
            };

            // A double tap or a lost response: the bottle already went out on this very sale.
            const own = sale.items.find((l) => l.id === unit.sale_item_id);
            if (own) return progress(own);

            if (unit.status === "SOLD") throw AppError.conflict("Already sold");
            if (unit.status === "IN_USE") throw AppError.conflict("This pack has been opened");
            if (unit.status !== "BOUND" || !unit.purchase_item)
                throw AppError.conflict(`This pack is ${statusWords(unit.status)}`);
            const lot = unit.purchase_item;
            if (isNonDepleting(lot.item.category))
                throw AppError.conflict("Equipment can't be sold yet");

            const lines = sale.items.filter((l) => l.item_id === lot.item_id);
            const itemName = (
                await tx.item.findUniqueOrThrow({
                    where: { id: lot.item_id },
                    select: { name: true },
                })
            ).name;
            if (!lines.length) throw AppError.conflict(`${itemName} isn't on this sale`);
            // One lock per line so two scans can't both take its last slot.
            for (const l of lines)
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${l.id}, 0))`;
            let line: (typeof lines)[number] | undefined;
            for (const l of lines) {
                if (
                    (await tx.stockUnit.count({ where: { sale_item_id: l.id } })) <
                    l.quantity.toNumber()
                ) {
                    line = l;
                    break;
                }
            }
            if (!line) {
                const wanted = lines.reduce((sum, l) => sum + l.quantity.toNumber(), 0);
                throw AppError.conflict(`All ${wanted} ${itemName} packs are already scanned`);
            }

            await lockLot(tx, lot.id);
            const amount = await unitAmount(tx, unit.id, lot);
            await StockLedgerService.record(tx, {
                item_id: lot.item_id,
                quantity: amount,
                direction: "OUT",
                reason: "SALE",
                ref_type: "SALE",
                // The bottle, not the sale: codedRemaining matches a lot's outflows by unit id.
                ref_id: unit.id,
                ...(await unitLocation(tx, unit.id, lot)),
            });
            await tx.stockUnit.update({
                where: { id: unit.id },
                data: {
                    status: "SOLD",
                    sale_item_id: line.id,
                    sold_at: new Date(),
                    sold_by_id: actor_id,
                },
            });
            await audit(tx, {
                table: "StockUnit",
                record_id: unit.id,
                action: "UPDATE",
                actor_id,
                note: "Bottle sold",
                after: { sale_id, sale_item_id: line.id, amount: amount.toString() },
            });
            return progress(line);
        });
    },

    /** QR sales with bottles still to scan, oldest first -- the phone's list. */
    async waiting(): Promise<ScanSale[]> {
        // ponytail: reads every QR sale and filters in memory. Fine while QR sales number in the hundreds; add a
        // stored scanned count or a SQL HAVING if this list ever slows down.
        const sales = await prisma.sale.findMany({
            where: { kind: "CODED" },
            select: saleSelect,
            orderBy: { sale_date: "asc" },
        });
        return (await withCounts(sales)).filter((s) => s.lines.some((l) => l.scanned < l.quantity));
    },

    /** One QR sale for the scan screen, with the bottles already scanned out on it. */
    async get(id: string): Promise<ScanSaleDetail> {
        const sale = await prisma.sale.findUnique({ where: { id }, select: saleSelect });
        if (!sale || sale.kind !== "CODED") throw AppError.notFound("Sale");
        const [view] = await withCounts([sale]);
        return { ...view!, bottles: await soldBottles(sale.items.map((l) => l.id)) };
    },
};

/** Bottles scanned out on these sale lines, with the size each one left stock at. Shared with the admin's sale
 *  detail. */
export async function soldBottles(lineIds: string[]): Promise<ScanSaleDetail["bottles"]> {
    const units = await prisma.stockUnit.findMany({
        where: { sale_item_id: { in: lineIds } },
        select: {
            id: true,
            sale_item_id: true,
            sold_at: true,
            sold_by: { select: { name: true } },
            purchase_item: {
                select: {
                    item: { select: { unit: true } },
                    purchase: { select: { purchase_date: true } },
                },
            },
        },
        orderBy: { sold_at: "asc" },
    });
    const rows = await prisma.stockLedger.findMany({
        where: { reason: "SALE", ref_type: "SALE", ref_id: { in: units.map((u) => u.id) } },
        select: { ref_id: true, quantity: true },
    });
    const size = new Map(rows.map((r) => [r.ref_id, r.quantity.toString()]));
    return units.map((u) => ({
        id: u.id,
        line_id: u.sale_item_id!,
        size: size.get(u.id) ?? "0",
        unit: u.purchase_item!.item.unit,
        lot_date: u.purchase_item!.purchase.purchase_date,
        sold_by: u.sold_by?.name ?? null,
        sold_at: u.sold_at!,
    }));
}
