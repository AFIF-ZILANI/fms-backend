import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { TaskService } from "@services/task.service";
import type { CreateTaskInput, UpdateTaskInput, ListTasksQuery } from "@validators/task.validator";

export const TaskController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListTasksQuery>(c, "query");
            const { rows, meta } = await TaskService.getAll(query);
            return sendList(c, rows, meta, "Tasks fetched successfully");
        });
    },

    async getById(c: Context) {
        return withHandler(c, async () => {
            const task = await TaskService.getById(c.req.param("id") ?? "");
            return sendSuccess(c, task, "Task fetched successfully");
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<CreateTaskInput>(c, "json");
            const task = await TaskService.create(body);
            return sendSuccess(c, task, "Task created", 201);
        });
    },

    async update(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<UpdateTaskInput>(c, "json");
            const task = await TaskService.update(c.req.param("id") ?? "", body);
            return sendSuccess(c, task, "Task updated");
        });
    },

    async deactivate(c: Context) {
        return withHandler(c, async () => {
            const task = await TaskService.setActive(c.req.param("id") ?? "", false);
            return sendSuccess(c, task, "Task deactivated");
        });
    },

    async reactivate(c: Context) {
        return withHandler(c, async () => {
            const task = await TaskService.setActive(c.req.param("id") ?? "", true);
            return sendSuccess(c, task, "Task reactivated");
        });
    },

    async remove(c: Context) {
        return withHandler(c, async () => {
            await TaskService.remove(c.req.param("id") ?? "");
            return sendSuccess(c, null, "Task deleted");
        });
    },
};
