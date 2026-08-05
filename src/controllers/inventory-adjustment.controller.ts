import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { InventoryAdjustmentService } from "@services/inventory-adjustment.service";
import type {
    CreateInventoryAdjustmentInput,
    ListInventoryAdjustmentsQuery,
} from "@validators/inventory-adjustment.validator";

export const InventoryAdjustmentController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListInventoryAdjustmentsQuery>(c, "query");
            const { adjustments, meta } = await InventoryAdjustmentService.getAll(query);
            return sendList(c, adjustments, meta, "Inventory adjustments fetched successfully");
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<CreateInventoryAdjustmentInput>(c, "json");
            const adjustment = await InventoryAdjustmentService.create(body);
            return sendSuccess(c, adjustment, "Inventory adjustment recorded", 201);
        });
    },
};
