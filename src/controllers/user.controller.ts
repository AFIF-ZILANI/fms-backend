import type { Context } from "hono";
import { UserService } from "@services/user.service";
import { withHandler } from "@lib/helper";
import type { CreateUserInput, UpdateUserInput } from "@validators/user.validator";
import { sendSuccess } from "@lib/response";

export const UserController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const users = await UserService.getAll();
            return sendSuccess(c, users, "Users fetched successfully");
        });
    },

    async getById(c: Context) {
        return withHandler(c, async () => {
            const id = c.req.param("id");
            const user = await UserService.getById(id ?? "");
            return sendSuccess(c, user, "User fetched successfully");
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const body = c.get("validatedBody") as CreateUserInput;
            const user = await UserService.create(body);
            return sendSuccess(c, user, "User created", 201);
        });
    },

    async update(c: Context) {
        return withHandler(c, async () => {
            const body = c.get("validatedBody") as UpdateUserInput;
            const user = await UserService.update(c.req.param("id") ?? "", body);
            return sendSuccess(c, user, "User updated");
        });
    },

    async remove(c: Context) {
        return withHandler(c, async () => {
            await UserService.remove(c.req.param("id") ?? "");
            return sendSuccess(c, null, "User deleted");
        });
    },
};
