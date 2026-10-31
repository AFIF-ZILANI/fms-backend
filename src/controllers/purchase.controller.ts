import type { Context } from "hono";
import { getActorId } from "@lib/current-actor";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { PurchaseService, PurchaseItemService } from "@services/purchase.service";
import type {
    AddPurchaseChargeInput,
    CreatePurchaseInput,
    ListPurchasesQuery,
    ListPurchaseItemsQuery,
    CompletePurchaseItemInput,
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
            const body = {
                ...getValid<CreatePurchaseInput>(c, "json"),
                recorded_by_id: await getActorId(c),
            };
            const purchase = await PurchaseService.create(body);
            return sendSuccess(c, purchase, "Purchase recorded", 201);
        });
    },

    async addCharge(c: Context) {
        return withHandler(c, async () => {
            const body = {
                ...getValid<Omit<AddPurchaseChargeInput, "recorded_by_id">>(c, "json"),
                recorded_by_id: await getActorId(c),
            };
            const charge = await PurchaseService.addCharge(c.req.param("id") ?? "", body);
            return sendSuccess(c, charge, "Charge added", 201);
        });
    },

    async remove(c: Context) {
        return withHandler(c, async () => {
            await PurchaseService.remove(c.req.param("id") ?? "", await getActorId(c));
            return sendSuccess(c, null, "Purchase removed");
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

    async complete(c: Context) {
        return withHandler(c, async () => {
            const { unit_count } = getValid<CompletePurchaseItemInput>(c, "json");
            const lot = await PurchaseItemService.complete(c.req.param("id") ?? "", unit_count);
            return sendSuccess(c, lot, "Lot marked complete");
        });
    },
};
