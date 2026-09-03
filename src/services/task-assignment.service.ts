import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type {
    CreateTaskAssignmentInput,
    UpdateTaskAssignmentInput,
    CompleteTaskAssignmentInput,
    ListTaskAssignmentsQuery,
} from "@validators/task-assignment.validator";

// The mobile dashboard routes a task by its type's code, so every read hands
// back the task and its type rather than making the client fetch them.
const withTask = {
    task: { include: { task_type: true } },
    employee: { include: { profile: true } },
    house: true,
} as const;

export const TaskAssignmentService = {
    async getAll(query: ListTaskAssignmentsQuery) {
        const dueRange = {
            ...(query.due_from !== undefined && { gte: query.due_from }),
            ...(query.due_to !== undefined && { lte: query.due_to }),
        };
        const where = {
            ...(query.employee_id !== undefined && { employee_id: query.employee_id }),
            ...(query.house_id !== undefined && { house_id: query.house_id }),
            ...(query.status !== undefined && { status: query.status }),
            ...(Object.keys(dueRange).length > 0 && { due_at: dueRange }),
        };
        const [rows, total] = await Promise.all([
            prisma.employeeTaskAssignment.findMany({
                where,
                include: withTask,
                orderBy: { due_at: "asc" },
                ...toSkipTake(query),
            }),
            prisma.employeeTaskAssignment.count({ where }),
        ]);
        return { rows, meta: buildMeta(total, query) };
    },

    async getById(id: string) {
        const row = await prisma.employeeTaskAssignment.findUnique({
            where: { id },
            include: withTask,
        });
        if (!row) throw AppError.notFound("EmployeeTaskAssignment");
        return row;
    },

    async create(data: CreateTaskAssignmentInput) {
        try {
            return await prisma.employeeTaskAssignment.create({
                data: {
                    employee_id: data.employee_id,
                    assigned_by_id: data.assigned_by_id,
                    task_id: data.task_id,
                    title: data.title,
                    due_at: data.due_at,
                    idempotency_key: data.idempotency_key ?? crypto.randomUUID(),
                    ...(data.description !== undefined && { description: data.description }),
                    ...(data.house_id !== undefined && { house_id: data.house_id }),
                    ...(data.location_note !== undefined && { location_note: data.location_note }),
                },
                include: withTask,
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    /** Edits the assignment's own fields. Status moves through complete/cancel
     *  only -- there's no path here that sets it. */
    async update(id: string, data: UpdateTaskAssignmentInput) {
        const existing = await prisma.employeeTaskAssignment.findUnique({ where: { id } });
        if (!existing) throw AppError.notFound("EmployeeTaskAssignment");
        if (existing.status !== "PENDING") {
            throw AppError.conflict(
                `Task is already ${existing.status.toLowerCase()} and can no longer be edited`,
            );
        }

        // Setting one side of the location clears the other, so an edit can move
        // a task from a house to "front gate" without leaving both populated --
        // the same either/or the create schema refuses outright.
        const location = {
            ...(data.house_id !== undefined && { house_id: data.house_id, location_note: null }),
            ...(data.location_note !== undefined && {
                location_note: data.location_note,
                house_id: null,
            }),
        };

        try {
            return await prisma.employeeTaskAssignment.update({
                where: { id },
                data: {
                    ...(data.title !== undefined && { title: data.title }),
                    ...(data.description !== undefined && { description: data.description }),
                    ...(data.due_at !== undefined && { due_at: data.due_at }),
                    ...location,
                },
                include: withTask,
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    /**
     * Idempotent by design: completing an already-DONE task returns the existing
     * row instead of 409ing. The mobile client queues this write offline and
     * replays it when a response is lost, so a replay has to look like success --
     * otherwise a completed task dead-letters in the outbox and the worker is
     * told their finished work failed.
     */
    async complete(id: string, data: CompleteTaskAssignmentInput) {
        const existing = await prisma.employeeTaskAssignment.findUnique({ where: { id } });
        if (!existing) throw AppError.notFound("EmployeeTaskAssignment");
        if (existing.status === "CANCELLED") {
            throw AppError.conflict("Task is cancelled and cannot be completed");
        }
        if (existing.status === "DONE") {
            return prisma.employeeTaskAssignment.findUniqueOrThrow({
                where: { id },
                include: withTask,
            });
        }

        return prisma.employeeTaskAssignment.update({
            where: { id },
            data: {
                status: "DONE",
                completed_at: new Date(),
                ...(data.completion_note !== undefined && {
                    completion_note: data.completion_note,
                }),
            },
            include: withTask,
        });
    },

    /** Same replay tolerance as complete(), for the same reason. */
    async cancel(id: string) {
        const existing = await prisma.employeeTaskAssignment.findUnique({ where: { id } });
        if (!existing) throw AppError.notFound("EmployeeTaskAssignment");
        if (existing.status === "DONE") {
            throw AppError.conflict("Task is already done and cannot be cancelled");
        }
        if (existing.status === "CANCELLED") {
            return prisma.employeeTaskAssignment.findUniqueOrThrow({
                where: { id },
                include: withTask,
            });
        }

        return prisma.employeeTaskAssignment.update({
            where: { id },
            data: { status: "CANCELLED" },
            include: withTask,
        });
    },
};
