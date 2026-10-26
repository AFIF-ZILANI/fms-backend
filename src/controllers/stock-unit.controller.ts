import type { Context } from "hono";
import { getActorId } from "@lib/current-actor";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { StockUnitService } from "@services/stock-unit.service";
import type {
    ProvisionStockUnitsInput,
    MarkPrintedStockUnitsInput,
    UseStockUnitInput,
    BindStockUnitInput,
    RelocateStockUnitInput,
    SetStockUnitStatusInput,
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

    async counts(c: Context) {
        return withHandler(c, async () => {
            const counts = await StockUnitService.counts();
            return sendSuccess(c, counts, "Stock unit counts fetched");
        });
    },

    async provision(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<ProvisionStockUnitsInput>(c, "json");
            const units = await StockUnitService.provision(body.count);
            return sendSuccess(c, units, "Stock units provisioned", 201);
        });
    },

    async use(c: Context) {
        return withHandler(c, async () => {
            const body = {
                ...getValid<Omit<UseStockUnitInput, "recorded_by_id">>(c, "json"),
                recorded_by_id: await getActorId(c),
            };
            const unit = await StockUnitService.use(c.req.param("id") ?? "", body);
            return sendSuccess(c, unit, body.action === "START" ? "Unit in use" : "Unit used up");
        });
    },

    async markPrinted(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<MarkPrintedStockUnitsInput>(c, "json");
            const result = await StockUnitService.markPrinted(body.ids);
            return sendSuccess(c, result, "Stock units marked printed");
        });
    },

    async bind(c: Context) {
        return withHandler(c, async () => {
            const body = {
                ...getValid<BindStockUnitInput>(c, "json"),
                bound_by_id: await getActorId(c),
            };
            const unit = await StockUnitService.bind(c.req.param("id") ?? "", body);
            return sendSuccess(c, unit, "Stock unit bound");
        });
    },

    async relocate(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<RelocateStockUnitInput>(c, "json");
            const unit = await StockUnitService.relocate(
                c.req.param("id") ?? "",
                body.house_id ?? null,
                body.idempotency_key ?? crypto.randomUUID(),
                body.stock_transfer_id,
                await getActorId(c),
            );
            return sendSuccess(c, unit, "Stock unit relocated");
        });
    },

    async dispose(c: Context) {
        return withHandler(c, async () => {
            const unit = await StockUnitService.dispose(c.req.param("id") ?? "");
            return sendSuccess(c, unit, "Stock unit disposed");
        });
    },

    async setStatus(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<SetStockUnitStatusInput>(c, "json");
            const unit = await StockUnitService.setStatus(c.req.param("id") ?? "", body.status);
            return sendSuccess(c, unit, "Stock unit status updated");
        });
    },

    async remove(c: Context) {
        return withHandler(c, async () => {
            await StockUnitService.remove(c.req.param("id") ?? "");
            return sendSuccess(c, null, "Stock unit deleted");
        });
    },
};
