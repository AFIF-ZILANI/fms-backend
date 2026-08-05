import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { VaccinationService } from "@services/vaccination.service";
import type {
    CreateVaccinationInput,
    ListVaccinationsQuery,
} from "@validators/vaccination.validator";

export const VaccinationController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListVaccinationsQuery>(c, "query");
            const { vaccinations, meta } = await VaccinationService.getAll(query);
            return sendList(c, vaccinations, meta, "Vaccinations fetched successfully");
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<CreateVaccinationInput>(c, "json");
            const vaccination = await VaccinationService.create(body);
            return sendSuccess(c, vaccination, "Vaccination logged", 201);
        });
    },
};
