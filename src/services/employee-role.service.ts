import prisma from "@lib/db";
import { Prisma } from "../../prisma/generated/prisma/client";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import { generateCode } from "@lib/code-gen";
import type {
    CreateEmployeeRoleInput,
    UpdateEmployeeRoleInput,
    ListEmployeeRolesQuery,
} from "@validators/employee-role.validator";

/**
 * Roles carry a salary, so this cannot use lookup-factory: its LookupDelegate
 * type admits only code/label/is_active and would drop reference_salary on every
 * write. The two pieces worth reusing are taken directly -- generateCode, and the
 * P2003 conflict message.
 */
export const EmployeeRoleService = {
    async getAll(query: ListEmployeeRolesQuery) {
        const where = query.active !== undefined ? { is_active: query.active === "true" } : {};
        const [rows, total] = await Promise.all([
            prisma.employeeRole.findMany({
                where,
                orderBy: { label: "asc" },
                // The count is what lets Settings say what a change affects, and
                // what makes "deactivate instead" a sentence the owner can act on.
                include: { _count: { select: { employees: true } } },
                ...toSkipTake(query),
            }),
            prisma.employeeRole.count({ where }),
        ]);
        return {
            rows: rows.map(({ _count, ...role }) => ({
                ...role,
                employee_count: _count.employees,
            })),
            meta: buildMeta(total, query),
        };
    },

    async getById(id: string) {
        const role = await prisma.employeeRole.findUnique({ where: { id } });
        if (!role) throw AppError.notFound("EmployeeRole");
        return role;
    },

    async create(data: CreateEmployeeRoleInput) {
        const code = generateCode(data.label);
        if (!code) throw AppError.badRequest("Label must contain at least one letter or number");
        try {
            return await prisma.employeeRole.create({
                data: { code, label: data.label, reference_salary: data.reference_salary },
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    /** The label and salary change; `code` never does. Employees.role references
     *  it, and a rename that moved the code would break that reference. */
    async update(id: string, data: UpdateEmployeeRoleInput) {
        await this.getById(id);
        if (!generateCode(data.label)) {
            throw AppError.badRequest("Label must contain at least one letter or number");
        }
        try {
            return await prisma.employeeRole.update({
                where: { id },
                data: { label: data.label, reference_salary: data.reference_salary },
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    async setActive(id: string, is_active: boolean) {
        await this.getById(id);
        return prisma.employeeRole.update({ where: { id }, data: { is_active } });
    },

    /** Hard delete, guarded by the ON DELETE RESTRICT FK from Employees rather
     *  than a pre-check -- the constraint is the source of truth and races nothing. */
    async remove(id: string) {
        await this.getById(id);
        try {
            return await prisma.employeeRole.delete({ where: { id } });
        } catch (err) {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
                throw AppError.conflict(
                    "EmployeeRole is still in use and cannot be deleted. Deactivate it instead.",
                );
            }
            throw err;
        }
    },
};
