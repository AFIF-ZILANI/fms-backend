import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { PayrollPayoutController } from "@controllers/payroll-payout.controller";
import {
    createPayrollPayoutSchema,
    failPayoutSchema,
    listPayrollPayoutsQuerySchema,
    markPaidSchema,
} from "@validators/payroll-payout.validator";

export const payrollPayoutRoutes = new Hono();

payrollPayoutRoutes.get(
    "/",
    zValidatorRfc7807("query", listPayrollPayoutsQuerySchema),
    PayrollPayoutController.getAll,
);
// Before /:id, or "fee-rates" is parsed as a payout id.
payrollPayoutRoutes.get("/fee-rates", PayrollPayoutController.feeRates);
payrollPayoutRoutes.get("/:id", PayrollPayoutController.getById);
payrollPayoutRoutes.post(
    "/",
    zValidatorRfc7807("json", createPayrollPayoutSchema),
    PayrollPayoutController.create,
);
// Proof of transfer is enforced in the service, where the method is known.
payrollPayoutRoutes.post(
    "/:id/mark-paid",
    zValidatorRfc7807("json", markPaidSchema),
    PayrollPayoutController.markPaid,
);
payrollPayoutRoutes.post(
    "/:id/mark-failed",
    zValidatorRfc7807("json", failPayoutSchema),
    PayrollPayoutController.markFailed,
);
