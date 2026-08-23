import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess } from "@lib/response";
import { getValid } from "@lib/valid";
import { TransferService } from "@services/transfer.service";
import type { CreateStockTransferInput } from "@validators/transfer.validator";

export const TransferController = {
    async create(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<CreateStockTransferInput>(c, "json");
            const transfer = await TransferService.create(body);
            return sendSuccess(c, transfer, "Stock transfer recorded", 201);
        });
    },
};
