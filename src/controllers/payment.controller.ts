import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { PaymentService } from "@services/payment.service";
import type {
    CreatePaymentInput,
    ListPaymentsQuery,
    TotalPaidQuery,
} from "@validators/payment.validator";

export const PaymentController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListPaymentsQuery>(c, "query");
            const { payments, meta } = await PaymentService.getAll(query);
            return sendList(c, payments, meta, "Payments fetched successfully");
        });
    },

    async getById(c: Context) {
        return withHandler(c, async () => {
            const payment = await PaymentService.getById(c.req.param("id") ?? "");
            return sendSuccess(c, payment, "Payment fetched successfully");
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<CreatePaymentInput>(c, "json");
            const payment = await PaymentService.create(body);
            return sendSuccess(c, payment, "Payment recorded", 201);
        });
    },

    async getTotalPaidForRef(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<TotalPaidQuery>(c, "query");
            const result = await PaymentService.getTotalPaidForRef(query.ref_type, query.ref_id);
            return sendSuccess(c, result, "Total paid computed");
        });
    },
};
