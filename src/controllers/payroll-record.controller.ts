import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { PayrollRecordService } from "@services/payroll-record.service";
import type {
    GeneratePayrollInput,
    ListPayrollRecordsQuery,
} from "@validators/payroll-record.validator";

export const PayrollRecordController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListPayrollRecordsQuery>(c, "query");
            const { records, meta } = await PayrollRecordService.getAll(query);
            return sendList(c, records, meta, "Payroll records fetched successfully");
        });
    },

    async generate(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<GeneratePayrollInput>(c, "json");
            const record = await PayrollRecordService.generate(body);
            return sendSuccess(c, record, "Payroll generated", 201);
        });
    },
};
