import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { PayrollRecordController } from "@controllers/payroll-record.controller";
import {
    generatePayrollSchema,
    listPayrollRecordsQuerySchema,
} from "@validators/payroll-record.validator";

export const payrollRecordRoutes = new Hono();

payrollRecordRoutes.get(
    "/",
    zValidatorRfc7807("query", listPayrollRecordsQuerySchema),
    PayrollRecordController.getAll,
);
payrollRecordRoutes.post(
    "/generate",
    zValidatorRfc7807("json", generatePayrollSchema),
    PayrollRecordController.generate,
);
