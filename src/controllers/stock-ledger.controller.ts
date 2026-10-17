import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendList, sendSuccess } from "@lib/response";
import { getValid } from "@lib/valid";
import { StockLedgerService } from "@services/stock-ledger.service";
import type { ListStockLedgerQuery } from "@validators/stock-ledger.validator";

export const StockLedgerController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListStockLedgerQuery>(c, "query");
            const { entries, meta } = await StockLedgerService.getAll(query);
            return sendList(c, entries, meta, "Stock ledger fetched successfully");
        });
    },

    async summary(c: Context) {
        return withHandler(c, async () => sendSuccess(c, await StockLedgerService.summary(), "Stock ledger summary fetched"));
    },
};
