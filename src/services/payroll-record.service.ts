import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { computePay, referenceSalaryFor } from "@lib/payroll-math";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type {
    GeneratePayrollInput,
    ListPayrollRecordsQuery,
} from "@validators/payroll-record.validator";

// PayrollRecord is a locked snapshot -- no update, ever (employee-payroll-
// design.md: even if the employee's reference salary or a criterion's point
// value changes later, past months' actual pay stays correct and auditable).
// Generating it also locks the month against new or edited score entries.
export const PayrollRecordService = {
    async getAll(query: ListPayrollRecordsQuery) {
        const where = {
            ...(query.employee_id !== undefined && { employee_id: query.employee_id }),
        };
        const [records, total] = await Promise.all([
            prisma.payrollRecord.findMany({
                where,
                orderBy: { month: "desc" },
                ...toSkipTake(query),
            }),
            prisma.payrollRecord.count({ where }),
        ]);
        return { records, meta: buildMeta(total, query) };
    },

    async getById(id: string) {
        const record = await prisma.payrollRecord.findUnique({
            where: { id },
            include: { employee: { include: { profile: true } }, payout: true },
        });
        if (!record) throw AppError.notFound("Payroll record");
        return record;
    },

    /**
     * Everything a payslip shows, assembled server-side: the wage split, every
     * score entry behind the month's allowance with its reason, and how it was
     * paid. The account number is masked to its last 4 digits here rather than
     * in the view -- a payslip request has no business receiving the whole one.
     */
    async payslip(id: string) {
        const record = await this.getById(id);
        const monthStart = record.month;
        const monthEnd = new Date(
            Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1),
        );

        const entries = await prisma.performanceScoreEntry.findMany({
            where: {
                employee_id: record.employee_id,
                status: "ACTIVE",
                incident_date: { gte: monthStart, lt: monthEnd },
            },
            orderBy: { incident_date: "asc" },
            select: { id: true, criterion: true, points: true, reason: true, incident_date: true },
        });

        const { payout, employee, ...figures } = record;
        return {
            ...figures,
            employee: {
                id: employee.id,
                name: employee.profile.name,
                mobile: employee.profile.mobile,
                role: employee.role,
                joining_date: employee.joining_date,
            },
            entries,
            payout: payout && {
                method: payout.method,
                account_last4: payout.account_number.slice(-4),
                amount: payout.amount,
                fee_paid_by_farm: payout.fee_paid_by_farm,
                status: payout.status,
                transaction_ref: payout.transaction_ref,
                paid_at: payout.paid_at,
            },
        };
    },

    /** Manual month-end action (per employee-payroll-design.md's open item,
     * resolved here the same way Batches.close() is manual): sums the
     * month's ACTIVE PerformanceScoreEntry points, clamps to [-10, +20], and
     * pays the guaranteed fixed wage plus an allowance of R × (10 + P) / 100.
     * VOIDED and DISPUTED entries are excluded: a disputed entry isn't settled,
     * and paying on it would have to be unwound. */
    async generate(data: GeneratePayrollInput) {
        const employee = await prisma.employees.findUnique({
            where: { id: data.employee_id },
            include: { roleRef: true },
        });
        if (!employee) throw AppError.notFound("Employee");

        const monthStart = new Date(
            Date.UTC(data.month.getUTCFullYear(), data.month.getUTCMonth(), 1),
        );
        const monthEnd = new Date(
            Date.UTC(data.month.getUTCFullYear(), data.month.getUTCMonth() + 1, 1),
        );

        // An employee who has left is still owed the month they left in, so the
        // termination month itself is payable -- but nothing after it. APPOINTED
        // and PROBATION are fully payable: a probationer is a worker, and
        // "appointed" only means the confirmation letter hasn't been issued.
        if (employee.terminated_at) {
            const leftMonth = new Date(
                Date.UTC(
                    employee.terminated_at.getUTCFullYear(),
                    employee.terminated_at.getUTCMonth(),
                    1,
                ),
            );
            if (monthStart > leftMonth) {
                throw AppError.badRequest(
                    `${employee.terminated_at.toISOString().slice(0, 10)} was this employee's last day; payroll can't be generated for a later month`,
                );
            }
        }

        const existing = await prisma.payrollRecord.findUnique({
            where: { employee_id_month: { employee_id: data.employee_id, month: monthStart } },
        });
        if (existing) {
            throw AppError.conflict("Payroll already generated for this employee and month");
        }

        const entries = await prisma.performanceScoreEntry.findMany({
            where: {
                employee_id: data.employee_id,
                status: "ACTIVE",
                incident_date: { gte: monthStart, lt: monthEnd },
            },
        });
        const score_sum = entries.reduce((sum, e) => sum + e.points, 0);
        // The role's standard unless this employee carries an override.
        const reference_salary = referenceSalaryFor(employee);
        const { adjustment_percent, fixed_wage, allowance, total_pay } = computePay(
            reference_salary,
            score_sum,
        );

        // The unique (employee, month) is the real guard; the check above is just a friendly
        // message. A racing second run lands here as a P2002, which becomes a 409, not a 500.
        try {
            return await prisma.payrollRecord.create({
                data: {
                    employee_id: data.employee_id,
                    month: monthStart,
                    reference_salary,
                    fixed_wage,
                    score_sum,
                    adjustment_percent,
                    allowance,
                    total_pay,
                },
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },
};
