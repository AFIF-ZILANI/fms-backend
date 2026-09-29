import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { EmployeeRoleService } from "@services/employee-role.service";
import type {
    CreateEmployeeRoleInput,
    UpdateEmployeeRoleInput,
    ListEmployeeRolesQuery,
} from "@validators/employee-role.validator";

export const EmployeeRoleController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListEmployeeRolesQuery>(c, "query");
            const { rows, meta } = await EmployeeRoleService.getAll(query);
            return sendList(c, rows, meta);
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<CreateEmployeeRoleInput>(c, "json");
            const role = await EmployeeRoleService.create(body);
            return sendSuccess(c, role, "Role created");
        });
    },

    async update(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<UpdateEmployeeRoleInput>(c, "json");
            const role = await EmployeeRoleService.update(c.req.param("id") ?? "", body);
            return sendSuccess(c, role, "Role updated");
        });
    },

    async deactivate(c: Context) {
        return withHandler(c, async () =>
            sendSuccess(
                c,
                await EmployeeRoleService.setActive(c.req.param("id") ?? "", false),
                "Role deactivated",
            ),
        );
    },

    async reactivate(c: Context) {
        return withHandler(c, async () =>
            sendSuccess(
                c,
                await EmployeeRoleService.setActive(c.req.param("id") ?? "", true),
                "Role reactivated",
            ),
        );
    },

    async remove(c: Context) {
        return withHandler(c, async () =>
            sendSuccess(c, await EmployeeRoleService.remove(c.req.param("id") ?? ""), "Role deleted"),
        );
    },
};
