import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type {
    CreateEmployeeInput,
    UpdateEmployeeInput,
    ListEmployeesQuery,
} from "@validators/employee.validator";

const include = {
    profile: { include: { avatar: true } },
    // Just enough to name an in-house reference on the detail page -- the full
    // employee record is one click away at /employees/:id.
    reference_employee: {
        select: { id: true, profile: { select: { name: true, mobile: true } } },
    },
} as const;

// A payload spans two rows: Profiles owns the person (name, contact, photo),
// Employees owns the job and the hire profile. Each method destructures the
// split itself -- create and update have different field-optionality, and one
// shared helper would only launder that difference into a cast.

/** Drops keys whose value is undefined -- Prisma treats an explicit undefined
 *  the same as absent, but exactOptionalPropertyTypes objects to passing it. */
function defined<T extends object>(obj: T) {
    return Object.fromEntries(
        Object.entries(obj).filter(([, v]) => v !== undefined),
    ) as { [K in keyof T]: Exclude<T[K], undefined> };
}

export const EmployeeService = {
    async getAll(query: ListEmployeesQuery) {
        const where = {
            ...(query.role !== undefined && { role: query.role }),
            ...(query.employment_status !== undefined && {
                employment_status: query.employment_status,
            }),
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
        const { name, mobile, email, address, avatar, ...employee } = data;
        try {
            return await prisma.$transaction(async (tx) => {
                // The photo is mandatory at the validator, so the Avatars row and
                // the Profile that points at it are written in the same transaction.
                const avatarRow = avatar ? await tx.avatars.create({ data: avatar }) : null;
                const profileRow = await tx.profiles.create({
                    data: {
                        name,
                        mobile,
                        address,
                        role: "EMPLOYEE",
                        ...(email !== undefined && { email }),
                        ...(avatarRow && { avatar_id: avatarRow.id }),
                    },
                });
                return tx.employees.create({
                    data: { ...defined(employee), profile_id: profileRow.id },
                    include,
                });
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    async update(id: string, data: UpdateEmployeeInput) {
        const existing = await prisma.employees.findUnique({ where: { id } });
        if (!existing) throw AppError.notFound("Employee");

        if (Object.keys(defined(data)).length === 0) {
            throw AppError.badRequest("No update fields provided");
        }

        const { name, mobile, email, address, avatar, reference_employee_id, ...employee } = data;
        try {
            return await prisma.$transaction(async (tx) => {
                // A replaced photo writes a new Avatars row rather than mutating the
                // old one -- the previous image stays addressable in Cloudinary and
                // in any audit record that captured it.
                const avatarRow = avatar ? await tx.avatars.create({ data: avatar }) : null;
                const profileUpdate = {
                    ...defined({ name, mobile, email, address }),
                    ...(avatarRow && { avatar_id: avatarRow.id }),
                };
                return tx.employees.update({
                    where: { id },
                    data: {
                        ...defined(employee),
                        // Nested writes put this update on Prisma's relation-shaped
                        // input, where the reference is connected rather than set as
                        // a raw id. An explicit null disconnects it -- that's how the
                        // form switches a reference from an employee to an outsider.
                        ...(reference_employee_id !== undefined && {
                            reference_employee: reference_employee_id
                                ? { connect: { id: reference_employee_id } }
                                : { disconnect: true },
                        }),
                        ...(Object.keys(profileUpdate).length > 0 && {
                            profile: { update: profileUpdate },
                        }),
                    },
                    include,
                });
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    /**
     * Terminating is one act, not two: the employment ends and the profile goes
     * inactive together, so a terminated employee can never be left showing as
     * active staff because the second call failed.
     */
    async terminate(id: string) {
        const employee = await prisma.employees.findUnique({ where: { id } });
        if (!employee) throw AppError.notFound("Employee");
        if (employee.employment_status === "TERMINATED") {
            throw AppError.badRequest("Employee is already terminated");
        }

        await prisma.$transaction([
            prisma.employees.update({
                where: { id },
                data: { employment_status: "TERMINATED" },
            }),
            prisma.profiles.update({
                where: { id: employee.profile_id },
                data: { is_active: false },
            }),
        ]);
        return this.getById(id);
    },

    /**
     * The mirror of terminate: a rehire starts the paperwork sequence over, so
     * they come back as APPOINTED rather than resuming whatever stage they left at.
     */
    async reinstate(id: string) {
        const employee = await prisma.employees.findUnique({ where: { id } });
        if (!employee) throw AppError.notFound("Employee");
        if (employee.employment_status !== "TERMINATED") {
            throw AppError.badRequest("Employee is not terminated");
        }

        await prisma.$transaction([
            prisma.employees.update({
                where: { id },
                data: { employment_status: "APPOINTED" },
            }),
            prisma.profiles.update({
                where: { id: employee.profile_id },
                data: { is_active: true },
            }),
        ]);
        return this.getById(id);
    },

    async setActive(id: string, is_active: boolean) {
        const employee = await prisma.employees.findUnique({ where: { id } });
        if (!employee) throw AppError.notFound("Employee");
        await prisma.profiles.update({ where: { id: employee.profile_id }, data: { is_active } });
        return this.getById(id);
    },
};
