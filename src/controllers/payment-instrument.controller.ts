import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { PaymentInstrumentService } from "@services/payment-instrument.service";
import type {
    CreatePaymentInstrumentInput,
    UpdatePaymentInstrumentInput,
    ListPaymentInstrumentsQuery,
} from "@validators/payment-instrument.validator";

export const PaymentInstrumentController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListPaymentInstrumentsQuery>(c, "query");
            const { instruments, meta } = await PaymentInstrumentService.getAll(query);
            return sendList(c, instruments, meta, "Payment instruments fetched successfully");
        });
    },

    async getById(c: Context) {
        return withHandler(c, async () => {
            const instrument = await PaymentInstrumentService.getById(c.req.param("id") ?? "");
            return sendSuccess(c, instrument, "Payment instrument fetched successfully");
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<CreatePaymentInstrumentInput>(c, "json");
            const instrument = await PaymentInstrumentService.create(body);
            return sendSuccess(c, instrument, "Payment instrument created", 201);
        });
    },

    async update(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<UpdatePaymentInstrumentInput>(c, "json");
            const instrument = await PaymentInstrumentService.update(c.req.param("id") ?? "", body);
            return sendSuccess(c, instrument, "Payment instrument updated");
        });
    },

    async deactivate(c: Context) {
        return withHandler(c, async () => {
            const instrument = await PaymentInstrumentService.setActive(
                c.req.param("id") ?? "",
                false,
            );
            return sendSuccess(c, instrument, "Payment instrument deactivated");
        });
    },

    async reactivate(c: Context) {
        return withHandler(c, async () => {
            const instrument = await PaymentInstrumentService.setActive(
                c.req.param("id") ?? "",
                true,
            );
            return sendSuccess(c, instrument, "Payment instrument reactivated");
        });
    },

    async getBalance(c: Context) {
        return withHandler(c, async () => {
            const balance = await PaymentInstrumentService.getBalance(c.req.param("id") ?? "");
            return sendSuccess(c, balance, "Balance computed");
        });
    },
};
