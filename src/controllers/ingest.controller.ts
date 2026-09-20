import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess } from "@lib/response";
import { getValid } from "@lib/valid";
import { getDevice } from "../middlewares/require-device";
import { IngestService } from "@services/ingest.service";
import type { IngestSaleInput, ListIngestedQuery } from "@validators/ingest.validator";

export const IngestController = {
    async create(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<IngestSaleInput>(c, "json");
            const device = getDevice(c);
            const result = await IngestService.ingest(body, device);
            return sendSuccess(c, result, "Sale received", result.created > 0 ? 201 : 200);
        });
    },

    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListIngestedQuery>(c, "query");
            const rows = await IngestService.list(query.status);
            return sendSuccess(c, rows, "Ingested sales fetched successfully");
        });
    },
};
