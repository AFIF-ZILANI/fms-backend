import type { Context } from "hono";
import { getActorId } from "@lib/current-actor";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { WeightRecordService } from "@services/weight-record.service";
import type {
    CreateWeightRecordInput,
    ListWeightRecordsQuery,
} from "@validators/weight-record.validator";

export const WeightRecordController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListWeightRecordsQuery>(c, "query");
            const { records, meta } = await WeightRecordService.getAll(query);
            return sendList(c, records, meta, "Weight records fetched successfully");
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const body = {
                ...getValid<CreateWeightRecordInput>(c, "json"),
                measured_by_id: await getActorId(c),
            };
            const record = await WeightRecordService.create(body);
            return sendSuccess(c, record, "Weight record logged", 201);
        });
    },
};
