import type { Context } from "hono";
import { getActorId } from "@lib/current-actor";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { EmployeePayoutAccountService } from "@services/employee-payout-account.service";
import type {
    CreatePayoutAccountInput,
    ListPayoutAccountsQuery,
} from "@validators/employee-payout-account.validator";

export const EmployeePayoutAccountController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListPayoutAccountsQuery>(c, "query");
            const { accounts, meta } = await EmployeePayoutAccountService.getAll(query);
            return sendList(c, accounts, meta, "Payout accounts fetched successfully");
        });
    },

    async getById(c: Context) {
        return withHandler(c, async () => {
            const account = await EmployeePayoutAccountService.getById(c.req.param("id") ?? "");
            return sendSuccess(c, account, "Payout account fetched successfully");
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const body = {
                ...getValid<CreatePayoutAccountInput>(c, "json"),
                verified_by_id: await getActorId(c),
            };
            const account = await EmployeePayoutAccountService.create(body);
            return sendSuccess(c, account, "Payout account added", 201);
        });
    },

    async close(c: Context) {
        return withHandler(c, async () => {
            const account = await EmployeePayoutAccountService.close(c.req.param("id") ?? "");
            return sendSuccess(c, account, "Payout account closed");
        });
    },
};
