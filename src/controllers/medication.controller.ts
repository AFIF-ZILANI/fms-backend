import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { MedicationService } from "@services/medication.service";
import type { CreateMedicationInput, ListMedicationsQuery } from "@validators/medication.validator";

export const MedicationController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListMedicationsQuery>(c, "query");
            const { medications, meta } = await MedicationService.getAll(query);
            return sendList(c, medications, meta, "Medications fetched successfully");
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<CreateMedicationInput>(c, "json");
            const medication = await MedicationService.create(body);
            return sendSuccess(c, medication, "Medication logged", 201);
        });
    },
};
