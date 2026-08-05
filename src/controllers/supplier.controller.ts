import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { SupplierService } from "@services/supplier.service";
import type {
    CreateSupplierInput,
    UpdateSupplierInput,
    ListSuppliersQuery,
} from "@validators/supplier.validator";

export const SupplierController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListSuppliersQuery>(c, "query");
            const { suppliers, meta } = await SupplierService.getAll(query);
            return sendList(c, suppliers, meta, "Suppliers fetched successfully");
        });
    },

    async getById(c: Context) {
        return withHandler(c, async () => {
            const supplier = await SupplierService.getById(c.req.param("id") ?? "");
            return sendSuccess(c, supplier, "Supplier fetched successfully");
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<CreateSupplierInput>(c, "json");
            const supplier = await SupplierService.create(body);
            return sendSuccess(c, supplier, "Supplier created", 201);
        });
    },

    async update(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<UpdateSupplierInput>(c, "json");
            const supplier = await SupplierService.update(c.req.param("id") ?? "", body);
            return sendSuccess(c, supplier, "Supplier updated");
        });
    },

    async deactivate(c: Context) {
        return withHandler(c, async () => {
            const supplier = await SupplierService.setActive(c.req.param("id") ?? "", false);
            return sendSuccess(c, supplier, "Supplier deactivated");
        });
    },

    async reactivate(c: Context) {
        return withHandler(c, async () => {
            const supplier = await SupplierService.setActive(c.req.param("id") ?? "", true);
            return sendSuccess(c, supplier, "Supplier reactivated");
        });
    },
};
