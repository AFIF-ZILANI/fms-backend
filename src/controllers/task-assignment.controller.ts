import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { TaskAssignmentService } from "@services/task-assignment.service";
import type {
    CreateTaskAssignmentInput,
    UpdateTaskAssignmentInput,
    CompleteTaskAssignmentInput,
    ListTaskAssignmentsQuery,
} from "@validators/task-assignment.validator";

export const TaskAssignmentController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListTaskAssignmentsQuery>(c, "query");
            const { rows, meta } = await TaskAssignmentService.getAll(query);
            return sendList(c, rows, meta, "Task assignments fetched successfully");
        });
    },

    async getById(c: Context) {
        return withHandler(c, async () => {
            const row = await TaskAssignmentService.getById(c.req.param("id") ?? "");
            return sendSuccess(c, row, "Task assignment fetched successfully");
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<CreateTaskAssignmentInput>(c, "json");
            const row = await TaskAssignmentService.create(body);
            return sendSuccess(c, row, "Task assigned", 201);
        });
    },

    async update(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<UpdateTaskAssignmentInput>(c, "json");
            const row = await TaskAssignmentService.update(c.req.param("id") ?? "", body);
            return sendSuccess(c, row, "Task assignment updated");
        });
    },

    async complete(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<CompleteTaskAssignmentInput>(c, "json");
            const row = await TaskAssignmentService.complete(c.req.param("id") ?? "", body);
            return sendSuccess(c, row, "Task completed");
        });
    },

    async cancel(c: Context) {
        return withHandler(c, async () => {
            const row = await TaskAssignmentService.cancel(c.req.param("id") ?? "");
            return sendSuccess(c, row, "Task cancelled");
        });
    },
};
