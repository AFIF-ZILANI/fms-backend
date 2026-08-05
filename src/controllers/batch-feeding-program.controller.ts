import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { BatchFeedingProgramService } from "@services/batch-feeding-program.service";
import type {
    CreateFeedingProgramInput,
    UpdateFeedingProgramInput,
    ListFeedingProgramsQuery,
} from "@validators/batch-feeding-program.validator";

export const BatchFeedingProgramController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListFeedingProgramsQuery>(c, "query");
            const { programs, meta } = await BatchFeedingProgramService.getAll(query);
            return sendList(c, programs, meta, "Feeding programs fetched successfully");
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<CreateFeedingProgramInput>(c, "json");
            const program = await BatchFeedingProgramService.create(body);
            return sendSuccess(c, program, "Feeding program created", 201);
        });
    },

    async setEndDay(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<UpdateFeedingProgramInput>(c, "json");
            const program = await BatchFeedingProgramService.setEndDay(
                c.req.param("id") ?? "",
                body.end_day,
            );
            return sendSuccess(c, program, "Feeding program updated");
        });
    },
};
