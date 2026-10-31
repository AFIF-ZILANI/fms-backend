import type { Context } from "hono";
import { getActorId } from "@lib/current-actor";
import { withHandler } from "@lib/helper";
import { sendNoContent, sendSuccess } from "@lib/response";
import { getValid } from "@lib/valid";
import { BatchVaccineScheduleService } from "@services/batch-vaccine-schedule.service";
import type {
    ApplyVaccineTemplateInput,
    CancelVaccineInput,
    ConfirmVaccineInput,
    CreateBatchVaccineScheduleInput,
    RescheduleVaccineInput,
    UpdateBatchVaccineScheduleInput,
} from "@validators/batch-vaccine-schedule.validator";

const id = (c: Context) => c.req.param("id") ?? "";

export const BatchVaccineScheduleController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const { batch_id } = getValid<{ batch_id: string }>(c, "query");
            const rows = await BatchVaccineScheduleService.getAll(batch_id);
            return sendSuccess(c, rows, "Vaccine schedule fetched successfully");
        });
    },

    async apply(c: Context) {
        return withHandler(c, async () => {
            const rows = await BatchVaccineScheduleService.apply(
                getValid<ApplyVaccineTemplateInput>(c, "json"),
                await getActorId(c),
            );
            return sendSuccess(c, rows, "Vaccine template applied", 201);
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const row = await BatchVaccineScheduleService.create(
                getValid<CreateBatchVaccineScheduleInput>(c, "json"),
                await getActorId(c),
            );
            return sendSuccess(c, row, "Vaccine added", 201);
        });
    },

    async update(c: Context) {
        return withHandler(c, async () => {
            const row = await BatchVaccineScheduleService.update(
                id(c),
                getValid<UpdateBatchVaccineScheduleInput>(c, "json"),
                await getActorId(c),
            );
            return sendSuccess(c, row, "Vaccine updated");
        });
    },

    async remove(c: Context) {
        return withHandler(c, async () => {
            await BatchVaccineScheduleService.remove(id(c), await getActorId(c));
            return sendNoContent();
        });
    },

    async reschedule(c: Context) {
        return withHandler(c, async () => {
            const row = await BatchVaccineScheduleService.reschedule(
                id(c),
                getValid<RescheduleVaccineInput>(c, "json"),
                await getActorId(c),
            );
            return sendSuccess(c, row, "Vaccine rescheduled");
        });
    },

    async cancel(c: Context) {
        return withHandler(c, async () => {
            const row = await BatchVaccineScheduleService.cancel(
                id(c),
                getValid<CancelVaccineInput>(c, "json"),
                await getActorId(c),
            );
            return sendSuccess(c, row, "Vaccine cancelled");
        });
    },

    async confirm(c: Context) {
        return withHandler(c, async () => {
            const row = await BatchVaccineScheduleService.confirm(
                id(c),
                getValid<ConfirmVaccineInput>(c, "json"),
                await getActorId(c),
            );
            return sendSuccess(c, row, "Vaccine confirmed");
        });
    },
};
