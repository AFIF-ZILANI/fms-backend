import prisma from "@lib/db";
import { Prisma } from "../../prisma/generated/prisma/client";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import { generateCode } from "@lib/code-gen";
import type { CreateTaskInput, UpdateTaskInput, ListTasksQuery } from "@validators/task.validator";

/**
 * The catalogue a Manager assigns from. Shaped like the other soft lookups but
 * not built on `createLookupService`: it carries `task_type_id`, which
 * `LookupDelegate` doesn't model, and that file warns against loosening the
 * delegate type for every caller. Same helpers, own module.
 */
export const TaskService = {
    async getAll(query: ListTasksQuery) {
        const where = {
            ...(query.active !== undefined && { is_active: query.active === "true" }),
            ...(query.task_type_id !== undefined && { task_type_id: query.task_type_id }),
        };
        const [rows, total] = await Promise.all([
            prisma.tasks.findMany({
                where,
                include: { task_type: true },
                orderBy: { label: "asc" },
                ...toSkipTake(query),
            }),
            prisma.tasks.count({ where }),
        ]);
        return { rows, meta: buildMeta(total, query) };
    },

    async getById(id: string) {
        const task = await prisma.tasks.findUnique({ where: { id }, include: { task_type: true } });
        if (!task) throw AppError.notFound("Task");
        return task;
    },

    async create(data: CreateTaskInput) {
        const code = generateCode(data.label);
        if (!code) throw AppError.badRequest("Label must contain at least one letter or number");
        try {
            return await prisma.tasks.create({
                data: {
                    code,
                    label: data.label,
                    ...(data.task_type_id !== undefined && { task_type_id: data.task_type_id }),
                },
                include: { task_type: true },
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    /**
     * Never writes `code`. The mobile app maps a task's type to a screen and
     * identifies rows by code, so regenerating it on rename -- which is what
     * lookup-factory does by default -- would break routing silently. Only the
     * human-facing label and the type link are editable.
     */
    async update(id: string, data: UpdateTaskInput) {
        const existing = await prisma.tasks.findUnique({ where: { id } });
        if (!existing) throw AppError.notFound("Task");

        if (data.label !== undefined && !generateCode(data.label)) {
            throw AppError.badRequest("Label must contain at least one letter or number");
        }

        try {
            return await prisma.tasks.update({
                where: { id },
                data: {
                    ...(data.label !== undefined && { label: data.label }),
                    ...(data.task_type_id !== undefined && { task_type_id: data.task_type_id }),
                },
                include: { task_type: true },
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    async setActive(id: string, is_active: boolean) {
        const existing = await prisma.tasks.findUnique({ where: { id } });
        if (!existing) throw AppError.notFound("Task");
        return prisma.tasks.update({
            where: { id },
            data: { is_active },
            include: { task_type: true },
        });
    },

    /** Hard delete, guarded by the ON DELETE RESTRICT from EmployeeTaskAssignment
     *  rather than a pre-check -- the DB constraint is the source of truth and
     *  races nothing. Same call as the other lookups. */
    async remove(id: string) {
        const existing = await prisma.tasks.findUnique({ where: { id } });
        if (!existing) throw AppError.notFound("Task");
        try {
            return await prisma.tasks.delete({ where: { id } });
        } catch (err) {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
                throw AppError.conflict(
                    "Task is still in use and cannot be deleted. Deactivate it instead.",
                );
            }
            throw err;
        }
    },
};
