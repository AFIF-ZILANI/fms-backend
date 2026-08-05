import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { MortalityLogService } from "@services/mortality-log.service";
import type {
    CreateMortalityLogInput,
    ListMortalityLogsQuery,
} from "@validators/mortality-log.validator";

export const MortalityLogController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListMortalityLogsQuery>(c, "query");
            const { logs, meta } = await MortalityLogService.getAll(query);
            return sendList(c, logs, meta, "Mortality logs fetched successfully");
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<CreateMortalityLogInput>(c, "json");
            const log = await MortalityLogService.create(body);
            return sendSuccess(c, log, "Mortality logged", 201);
        });
    },
};
