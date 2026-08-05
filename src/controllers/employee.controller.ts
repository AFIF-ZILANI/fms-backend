import type { Context } from "hono";
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

    async getById(c: Context) {
        return withHandler(c, async () => {
            const employee = await EmployeeService.getById(c.req.param("id") ?? "");
            return sendSuccess(c, employee, "Employee fetched successfully");
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<CreateEmployeeInput>(c, "json");
            const employee = await EmployeeService.create(body);
            return sendSuccess(c, employee, "Employee created", 201);
        });
    },

    async update(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<UpdateEmployeeInput>(c, "json");
            const employee = await EmployeeService.update(c.req.param("id") ?? "", body);
            return sendSuccess(c, employee, "Employee updated");
        });
    },

    async deactivate(c: Context) {
        return withHandler(c, async () => {
            const employee = await EmployeeService.setActive(c.req.param("id") ?? "", false);
            return sendSuccess(c, employee, "Employee deactivated");
        });
    },

    async reactivate(c: Context) {
        return withHandler(c, async () => {
            const employee = await EmployeeService.setActive(c.req.param("id") ?? "", true);
            return sendSuccess(c, employee, "Employee reactivated");
        });
    },
};
