import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { PaymentController } from "@controllers/payment.controller";
import {
    createPaymentSchema,
    listPaymentsQuerySchema,
    totalPaidQuerySchema,
} from "@validators/payment.validator";

export const paymentRoutes = new Hono();

paymentRoutes.get(
    "/",
    zValidatorRfc7807("query", listPaymentsQuerySchema),
    PaymentController.getAll,
);
paymentRoutes.get(
    "/total-paid",
    zValidatorRfc7807("query", totalPaidQuerySchema),
    PaymentController.getTotalPaidForRef,
);
paymentRoutes.get("/:id", PaymentController.getById);
paymentRoutes.post("/", zValidatorRfc7807("json", createPaymentSchema), PaymentController.create);
