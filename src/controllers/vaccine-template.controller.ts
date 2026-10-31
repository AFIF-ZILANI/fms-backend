import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess } from "@lib/response";
import { getValid } from "@lib/valid";
import { VaccineTemplateService } from "@services/vaccine-template.service";
import type {
    CreateVaccineTemplateInput,
    ListVaccineTemplatesQuery,
    UpdateVaccineTemplateInput,
} from "@validators/vaccine-template.validator";

export const VaccineTemplateController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListVaccineTemplatesQuery>(c, "query");
            const templates = await VaccineTemplateService.getAll(query);
            return sendSuccess(c, templates, "Vaccine templates fetched successfully");
        });
    },

    async getById(c: Context) {
        return withHandler(c, async () => {
            const template = await VaccineTemplateService.getById(c.req.param("id") ?? "");
            return sendSuccess(c, template, "Vaccine template fetched successfully");
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const template = await VaccineTemplateService.create(
                getValid<CreateVaccineTemplateInput>(c, "json"),
            );
            return sendSuccess(c, template, "Vaccine template created", 201);
        });
    },

    async update(c: Context) {
        return withHandler(c, async () => {
            const template = await VaccineTemplateService.update(
                c.req.param("id") ?? "",
                getValid<UpdateVaccineTemplateInput>(c, "json"),
            );
            return sendSuccess(c, template, "Vaccine template updated");
        });
    },
};
