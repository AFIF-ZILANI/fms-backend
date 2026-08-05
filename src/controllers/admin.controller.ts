import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { AdminService } from "@services/admin.service";
import type {
    CreateAdminInput,
    UpdateAdminInput,
    ListAdminsQuery,
} from "@validators/admin.validator";

export const AdminController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListAdminsQuery>(c, "query");
            const { admins, meta } = await AdminService.getAll(query);
            return sendList(c, admins, meta, "Admins fetched successfully");
        });
    },

    async getById(c: Context) {
        return withHandler(c, async () => {
            const admin = await AdminService.getById(c.req.param("id") ?? "");
            return sendSuccess(c, admin, "Admin fetched successfully");
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<CreateAdminInput>(c, "json");
            const admin = await AdminService.create(body);
            return sendSuccess(c, admin, "Admin created", 201);
        });
    },

    async update(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<UpdateAdminInput>(c, "json");
            const admin = await AdminService.update(c.req.param("id") ?? "", body);
            return sendSuccess(c, admin, "Admin updated");
        });
    },

    async deactivate(c: Context) {
        return withHandler(c, async () => {
            const admin = await AdminService.setActive(c.req.param("id") ?? "", false);
            return sendSuccess(c, admin, "Admin deactivated");
        });
    },

    async reactivate(c: Context) {
        return withHandler(c, async () => {
            const admin = await AdminService.setActive(c.req.param("id") ?? "", true);
            return sendSuccess(c, admin, "Admin reactivated");
        });
    },
};
