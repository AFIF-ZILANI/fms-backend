import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { ItemService } from "@services/item.service";
import type { CreateItemInput, UpdateItemInput, ListItemsQuery } from "@validators/item.validator";

export const ItemController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListItemsQuery>(c, "query");
            const { items, meta } = await ItemService.getAll(query);
            return sendList(c, items, meta, "Items fetched successfully");
        });
    },

    async getById(c: Context) {
        return withHandler(c, async () => {
            const item = await ItemService.getById(c.req.param("id") ?? "");
            return sendSuccess(c, item, "Item fetched successfully");
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<CreateItemInput>(c, "json");
            const item = await ItemService.create(body);
            return sendSuccess(c, item, "Item created", 201);
        });
    },

    async update(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<UpdateItemInput>(c, "json");
            const item = await ItemService.update(c.req.param("id") ?? "", body);
            return sendSuccess(c, item, "Item updated");
        });
    },

    async deactivate(c: Context) {
        return withHandler(c, async () => {
            const item = await ItemService.setActive(c.req.param("id") ?? "", false);
            return sendSuccess(c, item, "Item deactivated");
        });
    },

    async reactivate(c: Context) {
        return withHandler(c, async () => {
            const item = await ItemService.setActive(c.req.param("id") ?? "", true);
            return sendSuccess(c, item, "Item reactivated");
        });
    },
};
