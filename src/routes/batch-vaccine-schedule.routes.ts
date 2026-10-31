import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { BatchVaccineScheduleController as C } from "@controllers/batch-vaccine-schedule.controller";
import {
    applyVaccineTemplateSchema,
    cancelVaccineSchema,
    confirmVaccineSchema,
    createBatchVaccineScheduleSchema,
    listBatchVaccineSchedulesQuerySchema,
    rescheduleVaccineSchema,
    updateBatchVaccineScheduleSchema,
} from "@validators/batch-vaccine-schedule.validator";

// Everything but GET and confirm is admin-only: employees are default-denied in lib/permissions.ts.
export const batchVaccineScheduleRoutes = new Hono();

batchVaccineScheduleRoutes.get(
    "/",
    zValidatorRfc7807("query", listBatchVaccineSchedulesQuerySchema),
    C.getAll,
);
batchVaccineScheduleRoutes.post(
    "/apply",
    zValidatorRfc7807("json", applyVaccineTemplateSchema),
    C.apply,
);
batchVaccineScheduleRoutes.post(
    "/",
    zValidatorRfc7807("json", createBatchVaccineScheduleSchema),
    C.create,
);
batchVaccineScheduleRoutes.patch(
    "/:id",
    zValidatorRfc7807("json", updateBatchVaccineScheduleSchema),
    C.update,
);
batchVaccineScheduleRoutes.delete("/:id", C.remove);
batchVaccineScheduleRoutes.post(
    "/:id/reschedule",
    zValidatorRfc7807("json", rescheduleVaccineSchema),
    C.reschedule,
);
batchVaccineScheduleRoutes.post(
    "/:id/cancel",
    zValidatorRfc7807("json", cancelVaccineSchema),
    C.cancel,
);
batchVaccineScheduleRoutes.post(
    "/:id/confirm",
    zValidatorRfc7807("json", confirmVaccineSchema),
    C.confirm,
);
