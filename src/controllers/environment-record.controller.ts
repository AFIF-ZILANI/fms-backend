import type { Context } from "hono";
import { getActorId } from "@lib/current-actor";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { EnvironmentRecordService } from "@services/environment-record.service";
import type {
    CreateEnvironmentRecordInput,
    ListEnvironmentRecordsQuery,
} from "@validators/environment-record.validator";

export const EnvironmentRecordController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListEnvironmentRecordsQuery>(c, "query");
            const { records, meta } = await EnvironmentRecordService.getAll(query);
            return sendList(c, records, meta, "Environment records fetched successfully");
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const body = {
                ...getValid<CreateEnvironmentRecordInput>(c, "json"),
                recorded_by_id: await getActorId(c),
            };
            const record = await EnvironmentRecordService.create(body);
            return sendSuccess(c, record, "Environment record logged", 201);
        });
    },
};
