import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess } from "@lib/response";
import { getValid } from "@lib/valid";
import { FinanceService } from "@services/finance.service";
import type {
    FinanceMonthlyQuery,
    FinanceOwedQuery,
    FinanceSummaryQuery,
} from "@validators/finance.validator";

/** An inclusive "to" day becomes the start of the next day: periods are [from, to). */
const dayAfter = (d: Date) => new Date(d.getTime() + 86_400_000);

export const FinanceController = {
    async summary(c: Context) {
        return withHandler(c, async () => {
            const q = getValid<FinanceSummaryQuery>(c, "query");
            const data = await FinanceService.summary({
                from: q.from,
                to: dayAfter(q.to),
                compare_from: q.compare_from,
                compare_to: q.compare_to ? dayAfter(q.compare_to) : undefined,
            });
            return sendSuccess(c, data, "Finance summary computed");
        });
    },

    async monthly(c: Context) {
        return withHandler(c, async () => {
            const q = getValid<FinanceMonthlyQuery>(c, "query");
            return sendSuccess(
                c,
                await FinanceService.monthly(q.months),
                "Monthly finance computed",
            );
        });
    },

    async owed(c: Context) {
        return withHandler(c, async () => {
            const q = getValid<FinanceOwedQuery>(c, "query");
            return sendSuccess(c, await FinanceService.owed(q.top), "Money owed computed");
        });
    },
};
