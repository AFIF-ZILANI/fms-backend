import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { CustomerService } from "@services/customer.service";
import type {
    CreateCustomerInput,
    UpdateCustomerInput,
    ListCustomersQuery,
} from "@validators/customer.validator";

export const CustomerController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListCustomersQuery>(c, "query");
            const { customers, meta } = await CustomerService.getAll(query);
            return sendList(c, customers, meta, "Customers fetched successfully");
        });
    },

    async getById(c: Context) {
        return withHandler(c, async () => {
            const customer = await CustomerService.getById(c.req.param("id") ?? "");
            return sendSuccess(c, customer, "Customer fetched successfully");
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<CreateCustomerInput>(c, "json");
            const customer = await CustomerService.create(body);
            return sendSuccess(c, customer, "Customer created", 201);
        });
    },

    async update(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<UpdateCustomerInput>(c, "json");
            const customer = await CustomerService.update(c.req.param("id") ?? "", body);
            return sendSuccess(c, customer, "Customer updated");
        });
    },

    async deactivate(c: Context) {
        return withHandler(c, async () => {
            const customer = await CustomerService.setActive(c.req.param("id") ?? "", false);
            return sendSuccess(c, customer, "Customer deactivated");
        });
    },

    async reactivate(c: Context) {
        return withHandler(c, async () => {
            const customer = await CustomerService.setActive(c.req.param("id") ?? "", true);
            return sendSuccess(c, customer, "Customer reactivated");
        });
    },
};
