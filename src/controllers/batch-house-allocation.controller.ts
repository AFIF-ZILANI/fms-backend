import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { BatchHouseAllocationService } from "@services/batch-house-allocation.service";
import type {
    CreateAllocationInput,
    ListAllocationsQuery,
} from "@validators/batch-house-allocation.validator";

export const BatchHouseAllocationController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListAllocationsQuery>(c, "query");
            const { allocations, meta } = await BatchHouseAllocationService.getAll(query);
            return sendList(c, allocations, meta, "Allocations fetched successfully");
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<CreateAllocationInput>(c, "json");
            const allocation = await BatchHouseAllocationService.create(body);
            return sendSuccess(c, allocation, "Allocation recorded", 201);
        });
    },
};
