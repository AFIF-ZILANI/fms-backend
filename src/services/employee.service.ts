import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import { defined } from "@lib/defined";
import { fixedWageFor } from "@lib/payroll-math";
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

/**
 * A probation end date only means anything while the employee is on probation.
 * Enforced here rather than in each form, so no caller -- web, mobile, a later
 * script -- can leave a confirmed employee showing a probation deadline.
 */
/** A probation end date only means anything while the employee is on probation.
 *  Spread inline at each write: a named helper returning a union confuses
 *  Prisma's checked/unchecked input overloads. */
const leavingProbation = (status?: string) => !!status && status !== "PROBATION";

export const EmployeeService = {
    async getAll(query: ListEmployeesQuery) {
        // is_active and q both constrain the same relation, so they merge into one
        // `profile` clause rather than the second quietly replacing the first.
        const profileWhere = {
            ...(query.is_active !== undefined && { is_active: query.is_active === "true" }),
            ...(query.q !== undefined && {
                OR: [
                    { name: { contains: query.q, mode: "insensitive" as const } },
                    { mobile: { contains: query.q } },
                ],
            }),
        };
        const where = {
            ...(query.role !== undefined && { role: query.role }),
            ...(query.employment_status !== undefined && {
                employment_status: query.employment_status,
            }),
            ...(Object.keys(profileWhere).length > 0 && { profile: profileWhere }),
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
                    data: {
                        ...defined(employee),
                        ...(leavingProbation(employee.employment_status) && {
                            probation_end_date: null,
                        }),
                        reference_salary: employee.reference_salary,
                        fixed_wage: fixedWageFor(employee.reference_salary),
                        profile_id: profileRow.id,
                    },
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

        // TERMINATED and is_active are two halves of one fact, and only
        // terminate()/reinstate() move both. Editing the status around them would
        // leave a terminated employee reading as active staff, or an active one
        // with no termination date -- so those transitions are refused here.
        if (data.employment_status && data.employment_status !== existing.employment_status) {
            if (existing.employment_status === "TERMINATED") {
                throw AppError.badRequest(
                    "This employee is terminated -- reinstate them before changing their stage",
                );
            }
            if (data.employment_status === "TERMINATED") {
                throw AppError.badRequest("Use terminate to end employment");
            }
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
                        ...(leavingProbation(employee.employment_status) && {
                            probation_end_date: null,
                        }),
                        // Keep the guaranteed wage in step with a changed reference
                        // salary -- they are one decision, not two fields to remember.
                        ...(employee.reference_salary !== undefined && {
                            fixed_wage: fixedWageFor(employee.reference_salary),
                        }),
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
                data: {
                    employment_status: "TERMINATED",
                    probation_end_date: null,
                    terminated_at: new Date(),
                },
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
                data: {
                    employment_status: "APPOINTED",
                    probation_end_date: null,
                    // Cleared, not kept: they are employed again, and a stale date
                    // would keep blocking payroll for every month after it.
                    terminated_at: null,
                },
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
