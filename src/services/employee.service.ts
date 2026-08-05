import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type {
    CreateEmployeeInput,
    UpdateEmployeeInput,
    ListEmployeesQuery,
} from "@validators/employee.validator";

const include = { profile: true } as const;

export const EmployeeService = {
    async getAll(query: ListEmployeesQuery) {
        const where = {
            ...(query.role !== undefined && { role: query.role }),
            ...(query.is_active !== undefined && {
                profile: { is_active: query.is_active === "true" },
            }),
        };
        const [employees, total] = await Promise.all([
            prisma.employees.findMany({
                where,
                include,
                orderBy: { created_at: "desc" },
                ...toSkipTake(query),
            }),
            prisma.employees.count({ where }),
        ]);
        return { employees, meta: buildMeta(total, query) };
    },

    async getById(id: string) {
        const employee = await prisma.employees.findUnique({ where: { id }, include });
        if (!employee) throw AppError.notFound("Employee");
        return employee;
    },

    async create(data: CreateEmployeeInput) {
        try {
            return await prisma.$transaction(async (tx) => {
                const profile = await tx.profiles.create({
                    data: {
                        name: data.name,
                        mobile: data.mobile,
                        role: "EMPLOYEE",
                        ...(data.email !== undefined && { email: data.email }),
                        ...(data.address !== undefined && { address: data.address }),
                    },
                });
                return tx.employees.create({
                    data: {
                        profile_id: profile.id,
                        role: data.role,
                        salary: data.salary,
                        ...(data.joining_date !== undefined && { joining_date: data.joining_date }),
                    },
                    include,
                });
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    async update(id: string, data: UpdateEmployeeInput) {
        const employee = await prisma.employees.findUnique({ where: { id } });
        if (!employee) throw AppError.notFound("Employee");

        const { name, mobile, email, address, role, salary, rating } = data;
        if (
            !name &&
            !mobile &&
            !email &&
            address === undefined &&
            !role &&
            salary === undefined &&
            rating === undefined
        ) {
            throw AppError.badRequest("No update fields provided");
        }

        try {
            return await prisma.employees.update({
                where: { id },
                data: {
                    ...(role && { role }),
                    ...(salary !== undefined && { salary }),
                    ...(rating !== undefined && { rating }),
                    profile: {
                        update: {
                            ...(name && { name }),
                            ...(mobile && { mobile }),
                            ...(email && { email }),
                            ...(address !== undefined && { address }),
                        },
                    },
                },
                include,
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    async setActive(id: string, is_active: boolean) {
        const employee = await prisma.employees.findUnique({ where: { id } });
        if (!employee) throw AppError.notFound("Employee");
        await prisma.profiles.update({ where: { id: employee.profile_id }, data: { is_active } });
        return this.getById(id);
    },
};
