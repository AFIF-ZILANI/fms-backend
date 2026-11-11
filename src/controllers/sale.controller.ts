import type { Context } from "hono";
import { getActorId } from "@lib/current-actor";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { SaleService } from "@services/sale.service";
import type {
    CreateSaleInput,
    ListSalesQuery,
    SalesSummaryQuery,
    SellableQuery,
} from "@validators/sale.validator";

export const SaleController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListSalesQuery>(c, "query");
            const { sales, meta } = await SaleService.getAll(query);
            return sendList(c, sales, meta, "Sales fetched successfully");
        });
    },

    async summary(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<SalesSummaryQuery>(c, "query");
            const summary = await SaleService.summary(query);
            return sendSuccess(c, summary, "Sales summary computed");
        });
    },

    async sellable(c: Context) {
        return withHandler(c, async () => {
            const rows = await SaleService.sellable(getValid<SellableQuery>(c, "query"));
            return sendSuccess(c, rows, "Sellable stock fetched");
        });
    },

    async getById(c: Context) {
        return withHandler(c, async () => {
            const sale = await SaleService.getById(c.req.param("id") ?? "");
            return sendSuccess(c, sale, "Sale fetched successfully");
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const body = {
                ...getValid<CreateSaleInput>(c, "json"),
                recorded_by_id: await getActorId(c),
            };
            const sale = await SaleService.create(body);
            return sendSuccess(c, sale, "Sale recorded", 201);
        });
    },
};
