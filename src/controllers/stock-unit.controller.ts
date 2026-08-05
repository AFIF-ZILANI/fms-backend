import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { StockUnitService } from "@services/stock-unit.service";
import type {
    ProvisionStockUnitsInput,
    BindStockUnitInput,
    RelocateStockUnitInput,
    ListStockUnitsQuery,
} from "@validators/stock-unit.validator";

export const StockUnitController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListStockUnitsQuery>(c, "query");
            const { stockUnits, meta } = await StockUnitService.getAll(query);
            return sendList(c, stockUnits, meta, "Stock units fetched successfully");
        });
    },

    async getById(c: Context) {
        return withHandler(c, async () => {
            const unit = await StockUnitService.getById(c.req.param("id") ?? "");
            return sendSuccess(c, unit, "Stock unit fetched successfully");
        });
    },

    async getByCode(c: Context) {
        return withHandler(c, async () => {
            const unit = await StockUnitService.getByCode(c.req.param("code") ?? "");
            return sendSuccess(c, unit, "Stock unit fetched successfully");
        });
    },

    async provision(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<ProvisionStockUnitsInput>(c, "json");
            const units = await StockUnitService.provision(body.count);
            return sendSuccess(c, units, "Stock units provisioned", 201);
        });
    },

    async bind(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<BindStockUnitInput>(c, "json");
            const unit = await StockUnitService.bind(c.req.param("id") ?? "", body);
            return sendSuccess(c, unit, "Stock unit bound");
        });
    },

    async relocate(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<RelocateStockUnitInput>(c, "json");
            const unit = await StockUnitService.relocate(c.req.param("id") ?? "", body.house_id);
            return sendSuccess(c, unit, "Stock unit relocated");
        });
    },

    async dispose(c: Context) {
        return withHandler(c, async () => {
            const unit = await StockUnitService.dispose(c.req.param("id") ?? "");
            return sendSuccess(c, unit, "Stock unit disposed");
        });
    },
};
