import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { getDefaultActorId } from "@lib/current-actor";
import { AuthService } from "@services/auth.service";
import { audit } from "@lib/audit";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import { defined } from "@lib/defined";
import { computePay, referenceSalaryFor } from "@lib/payroll-math";
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

    /**
     * The figures the roster page opens with. Computed here rather than reduced
     * client-side: several of them (live birds, payout status, per-employee
     * month-to-date points) can't be derived from one page of employees, and
     * doing it in the browser would silently be wrong the moment the roster
     * outgrows a single page.
     */
    async kpis() {
        const now = new Date();
        const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
        const probationHorizon = new Date(now.getTime() + 7 * 86_400_000);

        const [employees, mtdPoints, records, birds, overdue_tasks] = await Promise.all([
            prisma.employees.findMany({
                where: { profile: { is_active: true } },
                select: {
                    id: true,
                    reference_salary: true,
                    roleRef: { select: { reference_salary: true } },
                    employment_status: true,
                    probation_end_date: true,
                    payoutAccounts: { where: { active_to: null }, select: { id: true } },
                },
            }),
            // One grouped query, not one per employee.
            prisma.performanceScoreEntry.groupBy({
                by: ["employee_id"],
                where: { status: "ACTIVE", incident_date: { gte: monthStart } },
                _sum: { points: true },
            }),
            prisma.payrollRecord.findMany({
                select: { employee_id: true, month: true, total_pay: true, payout: true },
            }),
            prisma.batchHouseBalance.aggregate({ _sum: { quantity: true } }),
            prisma.employeeTaskAssignment.count({
                where: { status: "PENDING", due_at: { lt: now } },
            }),
        ]);

        const pointsByEmployee = new Map(
            mtdPoints.map((row) => [row.employee_id, row._sum.points ?? 0]),
        );

        let wage_bill_projected = 0;
        let negative_performers = 0;
        let no_payout_account = 0;
        let probation_due = 0;

        for (const e of employees) {
            const score = pointsByEmployee.get(e.id) ?? 0;
            // The projection uses the same formula payroll will, so the figure on
            // the dashboard is the one that will actually be paid.
            wage_bill_projected += computePay(referenceSalaryFor(e), score).total_pay.toNumber();
            if (score < 0) negative_performers += 1;
            if (e.payoutAccounts.length === 0) no_payout_account += 1;
            if (
                e.employment_status === "PROBATION" &&
                e.probation_end_date &&
                e.probation_end_date <= probationHorizon
            ) {
                probation_due += 1;
            }
        }

        const unpaid = records.filter((r) => r.payout?.status !== "CONFIRMED");
        const lastMonthRecords = records.filter((r) => r.month.getTime() === lastMonth.getTime());
        const lastMonthWages = lastMonthRecords.reduce((sum, r) => sum + r.total_pay.toNumber(), 0);
        const liveBirds = birds._sum.quantity ?? 0;

        return {
            active_employees: employees.length,
            wage_bill_projected,
            unpaid_wages: unpaid.reduce((sum, r) => sum + r.total_pay.toNumber(), 0),
            unpaid_runs: unpaid.length,
            // Last month's wages over today's flock: a tracking ratio, not costing.
            // Properly this would be bird-days across the month.
            labour_cost_per_bird: liveBirds > 0 ? lastMonthWages / liveBirds : null,
            last_month_wages: lastMonthWages,
            live_birds: liveBirds,
            payroll_missing: employees.filter(
                (e) => !lastMonthRecords.some((r) => r.employee_id === e.id),
            ).length,
            no_payout_account,
            probation_due,
            negative_performers,
            overdue_tasks,
            // Wages are due by the 7th working day; past that, unpaid is overdue.
            payout_overdue: now.getUTCDate() > 7 && unpaid.length > 0,
        };
    },

    async getById(id: string) {
        const employee = await prisma.employees.findUnique({ where: { id }, include });
        if (!employee) throw AppError.notFound("Employee");
        return employee;
    },

    async create(data: CreateEmployeeInput, actor_id?: string) {
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
                const created = await tx.employees.create({
                    data: {
                        ...defined(employee),
                        ...(leavingProbation(employee.employment_status) && {
                            probation_end_date: null,
                        }),
                        // Null when omitted: pay them the role's standard.
                        reference_salary: employee.reference_salary ?? null,
                        profile_id: profileRow.id,
                    },
                    include,
                });
                // Hiring creates the login: the admin hands the employee this once.
                const temp_password = await AuthService.issueTempPassword(profileRow.id, tx);
                if (actor_id) {
                    await audit(tx, {
                        table: "Employees",
                        record_id: created.id,
                        action: "CREATE",
                        actor_id,
                        note: "Employee hired, login created",
                        after: { role: created.role, email: profileRow.email },
                    });
                }
                return { ...created, temp_password };
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    /** Forgot-password recovery (there is no email): a new temp password, shown once. */
    async resetPassword(id: string, actor_id?: string) {
        const employee = await prisma.employees.findUnique({
            where: { id },
            select: { profile: { select: { id: true, email: true } } },
        });
        if (!employee) throw AppError.notFound("Employee");
        if (!employee.profile.email) {
            throw AppError.badRequest("Add an email to this employee before resetting their password");
        }
        const temp_password = await AuthService.issueTempPassword(employee.profile.id);
        if (actor_id) {
            await audit(prisma, {
                table: "Employees",
                record_id: id,
                action: "UPDATE",
                actor_id,
                note: "Password reset",
            });
        }
        return { temp_password };
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

        const {
            name,
            mobile,
            email,
            address,
            avatar,
            reference_employee_id,
            actor_id,
            role,
            ...employee
        } = data;
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

                // AuditLog's first writer. Redirecting someone's pay is the one
                // employee edit worth a permanent record, and an override is
                // meant to be visible as an exception rather than a silent edit.
                // Read fresh inside the transaction, not the `existing` fetched
                // before it opened -- a concurrent write landing in between would
                // otherwise compare against a stale figure and silently skip a
                // genuine change.
                if (employee.reference_salary !== undefined) {
                    const before = await tx.employees.findUnique({
                        where: { id },
                        select: { reference_salary: true },
                    });
                    const beforeValue = before?.reference_salary?.toString() ?? null;
                    // A real null (clearing the override) has to stay JSON null in
                    // the log, not the string "null" -- String(null) would collapse
                    // "cleared" and "somehow literally the text null" into the same
                    // value.
                    const afterValue =
                        employee.reference_salary === null ? null : String(employee.reference_salary);
                    if (beforeValue !== afterValue) {
                        await tx.auditLog.create({
                            data: {
                                table_name: "Employees",
                                record_id: id,
                                action: "UPDATE",
                                changed_by_id: actor_id ?? (await getDefaultActorId()),
                                before_data: { reference_salary: beforeValue },
                                after_data: { reference_salary: afterValue },
                                note: "Salary override changed",
                            },
                        });
                    }
                }

                return tx.employees.update({
                    where: { id },
                    data: {
                        ...defined(employee),
                        ...(leavingProbation(employee.employment_status) && {
                            probation_end_date: null,
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
                        // Same reason role can't be a plain scalar here: profile's
                        // nested update above already puts this write on the
                        // relation-shaped (checked) input, where role only exists
                        // via roleRef.
                        ...(role !== undefined && { roleRef: { connect: { code: role } } }),
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
    async terminate(id: string, actor_id?: string) {
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
            ...(actor_id
                ? [
                      audit(prisma, {
                          table: "Employees",
                          record_id: id,
                          action: "UPDATE",
                          actor_id,
                          note: "Employment terminated",
                          before: { employment_status: employee.employment_status },
                          after: { employment_status: "TERMINATED" },
                      }),
                  ]
                : []),
        ]);
        return this.getById(id);
    },

    /**
     * The mirror of terminate: a rehire starts the paperwork sequence over, so
     * they come back as APPOINTED rather than resuming whatever stage they left at.
     */
    async reinstate(id: string, actor_id?: string) {
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
            ...(actor_id
                ? [
                      audit(prisma, {
                          table: "Employees",
                          record_id: id,
                          action: "UPDATE",
                          actor_id,
                          note: "Employee reinstated",
                          before: { employment_status: "TERMINATED" },
                          after: { employment_status: "APPOINTED" },
                      }),
                  ]
                : []),
        ]);
        return this.getById(id);
    },

    async setActive(id: string, is_active: boolean, actor_id?: string) {
        const employee = await prisma.employees.findUnique({ where: { id } });
        if (!employee) throw AppError.notFound("Employee");
        await prisma.profiles.update({ where: { id: employee.profile_id }, data: { is_active } });
        if (actor_id) {
            await audit(prisma, {
                table: "Employees",
                record_id: id,
                action: "UPDATE",
                actor_id,
                note: is_active ? "Login reactivated" : "Login deactivated",
            });
        }
        return this.getById(id);
    },
};
