import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { BatchService } from "@services/batch.service";
import type {
    CreateBatchInput,
    UpdateBatchInput,
    CloseBatchInput,
    ListBatchesQuery,
} from "@validators/batch.validator";

export const BatchController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListBatchesQuery>(c, "query");
            const { batches, meta } = await BatchService.getAll(query);
            return sendList(c, batches, meta, "Batches fetched successfully");
        });
    },

    async getById(c: Context) {
        return withHandler(c, async () => {
            const batch = await BatchService.getById(c.req.param("id") ?? "");
            return sendSuccess(c, batch, "Batch fetched successfully");
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<CreateBatchInput>(c, "json");
            const batch = await BatchService.create(body);
            return sendSuccess(c, batch, "Batch created", 201);
        });
    },

    async update(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<UpdateBatchInput>(c, "json");
            const batch = await BatchService.update(c.req.param("id") ?? "", body);
            return sendSuccess(c, batch, "Batch updated");
        });
    },

    async close(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<CloseBatchInput>(c, "json");
            const batch = await BatchService.close(c.req.param("id") ?? "", body);
            return sendSuccess(c, batch, "Batch closed");
        });
    },
};
