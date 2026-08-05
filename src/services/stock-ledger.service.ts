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
        | "WASTAGE"
        | "EXPIRED"
        | "ADJUSTMENT"
        | "OPENING_BALANCE";
    ref_type: "PURCHASE" | "CONSUMPTION" | "ADJUSTMENT";
    ref_id: string;
    unit_cost?: Prisma.Decimal | number;
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
                include: { item: true },
                orderBy: { occurred_at: "desc" },
                ...toSkipTake(query),
            }),
            prisma.stockLedger.count({ where }),
        ]);
        return { entries, meta: buildMeta(total, query) };
    },

    record(tx: Prisma.TransactionClient, entry: LedgerEntryInput) {
        return tx.stockLedger.create({
            data: { ...entry, idempotency_key: entry.idempotency_key ?? crypto.randomUUID() },
        });
    },
};
