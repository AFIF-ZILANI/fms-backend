import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { OrganizationService, ItemOrganizationService } from "@services/organization.service";
import type {
    CreateOrganizationInput,
    UpdateOrganizationInput,
    ListOrganizationsQuery,
    CreateItemOrganizationInput,
} from "@validators/organization.validator";

export const OrganizationController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListOrganizationsQuery>(c, "query");
            const { organizations, meta } = await OrganizationService.getAll(query);
            return sendList(c, organizations, meta, "Organizations fetched successfully");
        });
    },

    async getById(c: Context) {
        return withHandler(c, async () => {
            const organization = await OrganizationService.getById(c.req.param("id") ?? "");
            return sendSuccess(c, organization, "Organization fetched successfully");
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<CreateOrganizationInput>(c, "json");
            const organization = await OrganizationService.create(body);
            return sendSuccess(c, organization, "Organization created", 201);
        });
    },

    async update(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<UpdateOrganizationInput>(c, "json");
            const organization = await OrganizationService.update(c.req.param("id") ?? "", body);
            return sendSuccess(c, organization, "Organization updated");
        });
    },
};

export const ItemOrganizationController = {
    async create(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<CreateItemOrganizationInput>(c, "json");
            const link = await ItemOrganizationService.create(body);
            return sendSuccess(c, link, "Item-organization link created", 201);
        });
    },

    async remove(c: Context) {
        return withHandler(c, async () => {
            await ItemOrganizationService.remove(c.req.param("id") ?? "");
            return sendSuccess(c, null, "Item-organization link removed");
        });
    },
};
