import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toBaseQuantity } from "@lib/unit-conversion";
import { getItemLocationBalance } from "@lib/stock-balance";
import { StockLedgerService } from "@services/stock-ledger.service";
import type { CreateStockTransferInput } from "@validators/transfer.validator";

const include = { item: true, from_warehouse: true, to_house: true } as const;

export const TransferService = {
    async create(data: CreateStockTransferInput) {
        try {
            return await prisma.$transaction(async (tx) => {
                const base_quantity = await toBaseQuantity(
                    tx,
                    data.item_id,
                    data.unit,
                    data.quantity,
                    "USABLE",
                );

                const warehouse = await tx.warehouses.findUnique({
                    where: { id: data.from_warehouse_id },
                });
                if (!warehouse) throw AppError.notFound("Warehouse");

                const available = await getItemLocationBalance(
                    tx,
                    data.item_id,
                    "WAREHOUSE",
                    data.from_warehouse_id,
                );
                if (available.lessThan(base_quantity)) {
                    throw AppError.conflict(
                        `Only ${available.toString()} of this item is available at this warehouse`,
                    );
                }

                const transfer = await tx.stockTransfer.create({
                    data: {
                        item_id: data.item_id,
                        from_warehouse_id: data.from_warehouse_id,
                        to_house_id: data.to_house_id,
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
                    location_type: "WAREHOUSE",
                    location_id: data.from_warehouse_id,
                });
                await StockLedgerService.record(tx, {
                    item_id: data.item_id,
                    quantity: base_quantity,
                    direction: "IN",
                    reason: "TRANSFER",
                    ref_type: "TRANSFER",
                    ref_id: transfer.id,
                    location_type: "HOUSE",
                    location_id: data.to_house_id,
                });

                return transfer;
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },
};
