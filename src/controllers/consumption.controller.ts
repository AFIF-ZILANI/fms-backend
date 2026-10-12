import type { Context } from "hono";
import { getActorId } from "@lib/current-actor";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { ConsumptionService } from "@services/consumption.service";
import type {
    CreateConsumptionInput,
    ListConsumptionsQuery,
} from "@validators/consumption.validator";
import type { StockActivitySummaryQuery } from "@validators/stock-activity.validator";

export const ConsumptionController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListConsumptionsQuery>(c, "query");
            const { consumptions, meta } = await ConsumptionService.getAll(query);
            return sendList(c, consumptions, meta, "Consumptions fetched successfully");
        });
    },

    async summary(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<StockActivitySummaryQuery>(c, "query");
            return sendSuccess(c, await ConsumptionService.summary(query), "Summary fetched");
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const body = {
                ...getValid<CreateConsumptionInput>(c, "json"),
                recorded_by_id: await getActorId(c),
            };
            const consumption = await ConsumptionService.create(body);
            return sendSuccess(c, consumption, "Consumption recorded", 201);
        });
    },
};
