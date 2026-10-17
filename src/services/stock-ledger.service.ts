import prisma from "@lib/db";
import type { Prisma } from "../../prisma/generated/prisma/client";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type { ListStockLedgerQuery } from "@validators/stock-ledger.validator";

type LedgerEntryInput = {
    item_id: string;
    quantity: Prisma.Decimal | number;
    direction: "IN" | "OUT";
    reason:
        | "PURCHASE"
        | "TRANSFER"
        | "CONSUMPTION"
        | "SALE"
        | "WASTAGE"
        | "EXPIRED"
        | "ADJUSTMENT"
        | "OPENING_BALANCE";
    ref_type: "PURCHASE" | "CONSUMPTION" | "SALE" | "ADJUSTMENT" | "TRANSFER";
    ref_id: string;
    unit_cost?: Prisma.Decimal | number;
    location_type?: "WAREHOUSE" | "HOUSE" | "DISPOSAL";
    location_id?: string;
    idempotency_key?: string;
};

// Read-only from the client's perspective -- entries are written by the
// domain action that causes them (Consumption, InventoryAdjustment), never
// posted directly. record() composes into that action's own transaction.
export const StockLedgerService = {
    async getAll(query: ListStockLedgerQuery) {
        const where = {
            ...(query.item_id !== undefined && { item_id: query.item_id }),
            ...(query.direction !== undefined && { direction: query.direction }),
            ...(query.reason !== undefined && { reason: query.reason }),
        };
        const [entries, total] = await Promise.all([
            prisma.stockLedger.findMany({
                where,
                include: { item: { select: { id: true, name: true, unit: true } } },
                orderBy: { occurred_at: "desc" },
                ...toSkipTake(query),
            }),
            prisma.stockLedger.count({ where }),
        ]);
        return { entries, meta: buildMeta(total, query) };
    },

    // Last-30-day movement summary for the ledger KPIs. Farm-scale, so the IN
    // value is summed in JS rather than raw SQL. ponytail: fixed 30-day window.
    async summary() {
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const recent = { occurred_at: { gte: since } };
        const [total, byDirection, loss, received] = await Promise.all([
            prisma.stockLedger.count(),
            prisma.stockLedger.groupBy({ by: ["direction"], where: recent, _count: true }),
            prisma.stockLedger.count({ where: { ...recent, reason: { in: ["WASTAGE", "EXPIRED"] } } }),
            prisma.stockLedger.findMany({
                where: { ...recent, direction: "IN", unit_cost: { not: null } },
                select: { quantity: true, unit_cost: true },
            }),
        ]);
        const count = (d: "IN" | "OUT") => byDirection.find((g) => g.direction === d)?._count ?? 0;
        const receivedValue = received.reduce((sum, e) => sum + Number(e.quantity) * Number(e.unit_cost), 0);
        return { total, in_30d: count("IN"), out_30d: count("OUT"), loss_30d: loss, received_value_30d: receivedValue };
    },

    record(tx: Prisma.TransactionClient, entry: LedgerEntryInput) {
        return tx.stockLedger.create({
            data: { ...entry, idempotency_key: entry.idempotency_key ?? crypto.randomUUID() },
        });
    },
};
