import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { PurchaseService, PurchaseItemService } from "@services/purchase.service";
import type {
    CreatePurchaseInput,
    ListPurchasesQuery,
    ListPurchaseItemsQuery,
} from "@validators/purchase.validator";

export const PurchaseController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListPurchasesQuery>(c, "query");
            const { purchases, meta } = await PurchaseService.getAll(query);
            return sendList(c, purchases, meta, "Purchases fetched successfully");
        });
    },

    async getById(c: Context) {
        return withHandler(c, async () => {
            const purchase = await PurchaseService.getById(c.req.param("id") ?? "");
            return sendSuccess(c, purchase, "Purchase fetched successfully");
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<CreatePurchaseInput>(c, "json");
            const purchase = await PurchaseService.create(body);
            return sendSuccess(c, purchase, "Purchase recorded", 201);
        });
    },
};

export const PurchaseItemController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListPurchaseItemsQuery>(c, "query");
            const { purchaseItems, meta } = await PurchaseItemService.getAll(query);
            return sendList(c, purchaseItems, meta, "Purchase items fetched successfully");
        });
    },
};
