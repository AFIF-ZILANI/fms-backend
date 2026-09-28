import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { PayrollPayoutService } from "@services/payroll-payout.service";
import type {
    CreatePayrollPayoutInput,
    FailPayoutInput,
    ListPayrollPayoutsQuery,
    MarkPaidInput,
} from "@validators/payroll-payout.validator";

export const PayrollPayoutController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListPayrollPayoutsQuery>(c, "query");
            const { payouts, meta } = await PayrollPayoutService.getAll(query);
            return sendList(c, payouts, meta, "Payouts fetched successfully");
        });
    },

    async getById(c: Context) {
        return withHandler(c, async () => {
            const payout = await PayrollPayoutService.getById(c.req.param("id") ?? "");
            return sendSuccess(c, payout, "Payout fetched successfully");
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<CreatePayrollPayoutInput>(c, "json");
            const payout = await PayrollPayoutService.create(body);
            return sendSuccess(c, payout, "Payout created", 201);
        });
    },

    async markPaid(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<MarkPaidInput>(c, "json");
            const payout = await PayrollPayoutService.markPaid(c.req.param("id") ?? "", body);
            return sendSuccess(c, payout, "Payout confirmed");
        });
    },

    async markFailed(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<FailPayoutInput>(c, "json");
            const payout = await PayrollPayoutService.markFailed(c.req.param("id") ?? "", body);
            return sendSuccess(c, payout, "Payout marked failed");
        });
    },
};
