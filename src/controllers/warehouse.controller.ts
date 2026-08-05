import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { WarehouseService } from "@services/warehouse.service";
import type {
    CreateWarehouseInput,
    UpdateWarehouseInput,
    ListWarehousesQuery,
} from "@validators/warehouse.validator";

export const WarehouseController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListWarehousesQuery>(c, "query");
            const { warehouses, meta } = await WarehouseService.getAll(query);
            return sendList(c, warehouses, meta, "Warehouses fetched successfully");
        });
    },

    async getById(c: Context) {
        return withHandler(c, async () => {
            const warehouse = await WarehouseService.getById(c.req.param("id") ?? "");
            return sendSuccess(c, warehouse, "Warehouse fetched successfully");
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<CreateWarehouseInput>(c, "json");
            const warehouse = await WarehouseService.create(body);
            return sendSuccess(c, warehouse, "Warehouse created", 201);
        });
    },

    async update(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<UpdateWarehouseInput>(c, "json");
            const warehouse = await WarehouseService.update(c.req.param("id") ?? "", body);
            return sendSuccess(c, warehouse, "Warehouse updated");
        });
    },
};
