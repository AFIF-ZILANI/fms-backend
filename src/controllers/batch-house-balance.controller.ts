import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { BatchHouseBalanceService } from "@services/batch-house-balance.service";
import type { ListBalancesQuery } from "@validators/batch-house-balance.validator";

export const BatchHouseBalanceController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListBalancesQuery>(c, "query");
            const { balances, meta } = await BatchHouseBalanceService.getAll(query);
            return sendList(c, balances, meta, "Balances fetched successfully");
        });
    },
};
