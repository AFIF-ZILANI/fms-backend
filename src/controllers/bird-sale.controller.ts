import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { BirdSaleService } from "@services/bird-sale.service";
import type {
    BirdSalesSummaryQuery,
    CreateBirdSaleInput,
    ListBirdSalesQuery,
} from "@validators/bird-sale.validator";

export const BirdSaleController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListBirdSalesQuery>(c, "query");
            const { birdSales, meta } = await BirdSaleService.getAll(query);
            return sendList(c, birdSales, meta, "Bird sales fetched successfully");
        });
    },

    async summary(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<BirdSalesSummaryQuery>(c, "query");
            const summary = await BirdSaleService.summary(query);
            return sendSuccess(c, summary, "Bird sales summary computed");
        });
    },

    async getById(c: Context) {
        return withHandler(c, async () => {
            const birdSale = await BirdSaleService.getById(c.req.param("id") ?? "");
            return sendSuccess(c, birdSale, "Bird sale fetched successfully");
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<CreateBirdSaleInput>(c, "json");
            const birdSale = await BirdSaleService.create(body);
            return sendSuccess(c, birdSale, "Bird sale recorded", 201);
        });
    },
};
