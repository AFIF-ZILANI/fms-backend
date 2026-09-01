import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toBaseQuantity } from "@lib/unit-conversion";
import { getItemLocationBalance } from "@lib/stock-balance";
import { StockLedgerService } from "@services/stock-ledger.service";
import type { Prisma } from "../../prisma/generated/prisma/client";
import type { CreateStockTransferInput } from "@validators/transfer.validator";

const include = { item: true } as const;

async function assertLocationExists(
    tx: Prisma.TransactionClient,
    type: "WAREHOUSE" | "HOUSE",
    id: string,
) {
    const found =
        type === "WAREHOUSE"
            ? await tx.warehouses.findUnique({ where: { id } })
            : await tx.houses.findUnique({ where: { id } });
    if (!found) throw AppError.notFound(type === "WAREHOUSE" ? "Warehouse" : "House");
}

export const TransferService = {
    async create(data: CreateStockTransferInput) {
        if (
            data.from_location_type === data.to_location_type &&
            data.from_location_id === data.to_location_id
        ) {
            throw AppError.conflict("Source and destination are the same location");
        }
        if (data.from_location_type === "WAREHOUSE" && data.to_location_type === "WAREHOUSE") {
            throw AppError.badRequest("Warehouse-to-warehouse transfers aren't supported");
        }

        try {
            return await prisma.$transaction(async (tx) => {
                const base_quantity = await toBaseQuantity(
                    tx,
                    data.item_id,
                    data.unit,
                    data.quantity,
                    "USABLE",
                );

                await assertLocationExists(tx, data.from_location_type, data.from_location_id);

                const available = await getItemLocationBalance(
                    tx,
                    data.item_id,
                    data.from_location_type,
                    data.from_location_id,
                );
                if (available.lessThan(base_quantity)) {
                    throw AppError.conflict(
                        `Only ${available.toString()} of this item is available at the source location`,
                    );
                }

                const transfer = await tx.stockTransfer.create({
                    data: {
                        item_id: data.item_id,
                        from_location_type: data.from_location_type,
                        from_location_id: data.from_location_id,
                        to_location_type: data.to_location_type,
                        to_location_id: data.to_location_id,
                        quantity: data.quantity,
                        unit: data.unit,
                        base_quantity,
                        recorded_by_id: data.recorded_by_id,
                        idempotency_key: data.idempotency_key ?? crypto.randomUUID(),
                        ...(data.note !== undefined && { note: data.note }),
                    },
                    include,
                });

                await StockLedgerService.record(tx, {
                    item_id: data.item_id,
                    quantity: base_quantity,
                    direction: "OUT",
                    reason: "TRANSFER",
                    ref_type: "TRANSFER",
                    ref_id: transfer.id,
                    location_type: data.from_location_type,
                    location_id: data.from_location_id,
                });
                await StockLedgerService.record(tx, {
                    item_id: data.item_id,
                    quantity: base_quantity,
                    direction: "IN",
                    reason: "TRANSFER",
                    ref_type: "TRANSFER",
                    ref_id: transfer.id,
                    location_type: data.to_location_type,
                    location_id: data.to_location_id,
                });

                return transfer;
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },
};
