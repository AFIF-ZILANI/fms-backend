import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess } from "@lib/response";
import { getValid } from "@lib/valid";
import { getDevice } from "../middlewares/require-device";
import { IngestService } from "@services/ingest.service";
import type {
    ConfirmIngestedInput,
    DismissIngestedInput,
    IngestSaleInput,
    ListIngestedQuery,
} from "@validators/ingest.validator";

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

    async confirm(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<ConfirmIngestedInput>(c, "json");
            const birdSale = await IngestService.confirm(c.req.param("id") ?? "", body);
            return sendSuccess(c, birdSale, "Sale confirmed", 201);
        });
    },

    async dismiss(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<DismissIngestedInput>(c, "json");
            const row = await IngestService.dismiss(
                c.req.param("id") ?? "",
                body.reason,
                body.reviewed_by_id,
            );
            return sendSuccess(c, row, "Sale dismissed");
        });
    },
};
