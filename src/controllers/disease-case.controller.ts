import type { Context } from "hono";
import { getActorId } from "@lib/current-actor";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { DiseaseCaseService } from "@services/disease-case.service";
import type {
    CreateDiseaseCaseInput,
    ListDiseaseCasesQuery,
    UpdateDiseaseCaseInput,
} from "@validators/disease-case.validator";

export const DiseaseCaseController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListDiseaseCasesQuery>(c, "query");
            const { cases, meta } = await DiseaseCaseService.getAll(query);
            return sendList(c, cases, meta, "Disease cases fetched successfully");
        });
    },

    async getById(c: Context) {
        return withHandler(c, async () => {
            const found = await DiseaseCaseService.getById(c.req.param("id") ?? "");
            return sendSuccess(c, found, "Disease case fetched successfully");
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const body = {
                ...getValid<CreateDiseaseCaseInput>(c, "json"),
                recorded_by_id: await getActorId(c),
            };
            const created = await DiseaseCaseService.create(body);
            return sendSuccess(c, created, "Disease case recorded", 201);
        });
    },

    async update(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<UpdateDiseaseCaseInput>(c, "json");
            const updated = await DiseaseCaseService.update(c.req.param("id") ?? "", body);
            return sendSuccess(c, updated, "Disease case updated");
        });
    },

    async remove(c: Context) {
        return withHandler(c, async () => {
            await DiseaseCaseService.remove(c.req.param("id") ?? "", await getActorId(c));
            return sendSuccess(c, null, "Disease case removed");
        });
    },
};
