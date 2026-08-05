import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { PaymentInstrumentController } from "@controllers/payment-instrument.controller";
import {
    createPaymentInstrumentSchema,
    updatePaymentInstrumentSchema,
    listPaymentInstrumentsQuerySchema,
} from "@validators/payment-instrument.validator";

export const paymentInstrumentRoutes = new Hono();

paymentInstrumentRoutes.get(
    "/",
    zValidatorRfc7807("query", listPaymentInstrumentsQuerySchema),
    PaymentInstrumentController.getAll,
);
paymentInstrumentRoutes.get("/:id", PaymentInstrumentController.getById);
paymentInstrumentRoutes.get("/:id/balance", PaymentInstrumentController.getBalance);
paymentInstrumentRoutes.post(
    "/",
    zValidatorRfc7807("json", createPaymentInstrumentSchema),
    PaymentInstrumentController.create,
);
paymentInstrumentRoutes.patch(
    "/:id",
    zValidatorRfc7807("json", updatePaymentInstrumentSchema),
    PaymentInstrumentController.update,
);
paymentInstrumentRoutes.post("/:id/deactivate", PaymentInstrumentController.deactivate);
paymentInstrumentRoutes.post("/:id/reactivate", PaymentInstrumentController.reactivate);
