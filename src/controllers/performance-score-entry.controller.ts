import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { PerformanceScoreEntryService } from "@services/performance-score-entry.service";
import type {
    CreateScoreEntryInput,
    ListScoreEntriesQuery,
} from "@validators/performance-score-entry.validator";

export const PerformanceScoreEntryController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListScoreEntriesQuery>(c, "query");
            const { entries, meta } = await PerformanceScoreEntryService.getAll(query);
            return sendList(c, entries, meta, "Score entries fetched successfully");
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<CreateScoreEntryInput>(c, "json");
            const entry = await PerformanceScoreEntryService.create(body);
            return sendSuccess(c, entry, "Score entry recorded", 201);
        });
    },
};
