import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { HouseService } from "@services/house.service";
import type {
    CreateHouseInput,
    UpdateHouseInput,
    ListHousesQuery,
} from "@validators/house.validator";

export const HouseController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListHousesQuery>(c, "query");
            const { houses, meta } = await HouseService.getAll(query);
            return sendList(c, houses, meta, "Houses fetched successfully");
        });
    },

    async getById(c: Context) {
        return withHandler(c, async () => {
            const house = await HouseService.getById(c.req.param("id") ?? "");
            return sendSuccess(c, house, "House fetched successfully");
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<CreateHouseInput>(c, "json");
            const house = await HouseService.create(body);
            return sendSuccess(c, house, "House created", 201);
        });
    },

    async update(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<UpdateHouseInput>(c, "json");
            const house = await HouseService.update(c.req.param("id") ?? "", body);
            return sendSuccess(c, house, "House updated");
        });
    },

    async deactivate(c: Context) {
        return withHandler(c, async () => {
            const house = await HouseService.setActive(c.req.param("id") ?? "", false);
            return sendSuccess(c, house, "House deactivated");
        });
    },

    async reactivate(c: Context) {
        return withHandler(c, async () => {
            const house = await HouseService.setActive(c.req.param("id") ?? "", true);
            return sendSuccess(c, house, "House reactivated");
        });
    },
};
