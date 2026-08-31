import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { StockHouseAllocationService } from "@services/stock-house-allocation.service";
import type { ListStockHouseAllocationsQuery } from "@validators/stock-house-allocation.validator";

export const StockHouseAllocationController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListStockHouseAllocationsQuery>(c, "query");
            const { entries, meta } = await StockHouseAllocationService.getAll(query);
            return sendList(c, entries, meta, "Stock house allocations fetched successfully");
        });
    },
};
