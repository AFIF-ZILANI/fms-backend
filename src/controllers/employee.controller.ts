import type { Context } from "hono";
import { getActorId } from "@lib/current-actor";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { EmployeeService } from "@services/employee.service";
import type {
    CreateEmployeeInput,
    UpdateEmployeeInput,
    ListEmployeesQuery,
} from "@validators/employee.validator";

export const EmployeeController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListEmployeesQuery>(c, "query");
            const { employees, meta } = await EmployeeService.getAll(query);
            return sendList(c, employees, meta, "Employees fetched successfully");
        });
    },

    async kpis(c: Context) {
        return withHandler(c, async () => {
            const kpis = await EmployeeService.kpis();
            return sendSuccess(c, kpis, "Employee KPIs fetched successfully");
        });
    },

    async getById(c: Context) {
        return withHandler(c, async () => {
            const employee = await EmployeeService.getById(c.req.param("id") ?? "");
            return sendSuccess(c, employee, "Employee fetched successfully");
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<CreateEmployeeInput>(c, "json");
            const employee = await EmployeeService.create(body, await getActorId(c));
            return sendSuccess(c, employee, "Employee created", 201);
        });
    },

    async update(c: Context) {
        return withHandler(c, async () => {
            const body = {
                ...getValid<UpdateEmployeeInput>(c, "json"),
                actor_id: await getActorId(c),
            };
            const employee = await EmployeeService.update(c.req.param("id") ?? "", body);
            return sendSuccess(c, employee, "Employee updated");
        });
    },

    async resetPassword(c: Context) {
        return withHandler(c, async () => {
            const result = await EmployeeService.resetPassword(
                c.req.param("id") ?? "",
                await getActorId(c),
            );
            return sendSuccess(c, result, "Password reset");
        });
    },

    async terminate(c: Context) {
        return withHandler(c, async () => {
            const employee = await EmployeeService.terminate(c.req.param("id") ?? "", await getActorId(c));
            return sendSuccess(c, employee, "Employee terminated");
        });
    },

    async reinstate(c: Context) {
        return withHandler(c, async () => {
            const employee = await EmployeeService.reinstate(c.req.param("id") ?? "", await getActorId(c));
            return sendSuccess(c, employee, "Employee reinstated");
        });
    },

    async deactivate(c: Context) {
        return withHandler(c, async () => {
            const employee = await EmployeeService.setActive(c.req.param("id") ?? "", false, await getActorId(c));
            return sendSuccess(c, employee, "Employee deactivated");
        });
    },

    async reactivate(c: Context) {
        return withHandler(c, async () => {
            const employee = await EmployeeService.setActive(c.req.param("id") ?? "", true, await getActorId(c));
            return sendSuccess(c, employee, "Employee reactivated");
        });
    },
};
