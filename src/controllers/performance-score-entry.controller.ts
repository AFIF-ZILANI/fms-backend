import type { Context } from "hono";
import { getActorId } from "@lib/current-actor";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { PerformanceScoreEntryService } from "@services/performance-score-entry.service";
import type {
    CreateScoreEntryInput,
    ListScoreEntriesQuery,
    VoidScoreEntryInput,
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
            const body = {
                ...getValid<CreateScoreEntryInput>(c, "json"),
                given_by_id: await getActorId(c),
            };
            const entry = await PerformanceScoreEntryService.create(body);
            return sendSuccess(c, entry, "Score entry recorded", 201);
        });
    },

    async void(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<VoidScoreEntryInput>(c, "json");
            const entry = await PerformanceScoreEntryService.void(
                c.req.param("id") ?? "",
                body,
                await getActorId(c),
            );
            return sendSuccess(c, entry, "Score entry voided");
        });
    },

    async dispute(c: Context) {
        return withHandler(c, async () => {
            const entry = await PerformanceScoreEntryService.dispute(c.req.param("id") ?? "");
            return sendSuccess(c, entry, "Score entry disputed");
        });
    },

    async acknowledge(c: Context) {
        return withHandler(c, async () => {
            const entry = await PerformanceScoreEntryService.acknowledge(
                c.req.param("id") ?? "",
                await getActorId(c),
            );
            return sendSuccess(c, entry, "Score entry acknowledged");
        });
    },
};
