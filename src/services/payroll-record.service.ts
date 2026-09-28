import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { computePay } from "@lib/payroll-math";
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

    /** Manual month-end action (per employee-payroll-design.md's open item,
     * resolved here the same way Batches.close() is manual): sums the
     * month's ACTIVE PerformanceScoreEntry points, clamps to [-10, +20], and
     * pays the guaranteed fixed wage plus an allowance of R × (10 + P) / 100.
     * VOIDED and DISPUTED entries are excluded: a disputed entry isn't settled,
     * and paying on it would have to be unwound. */
    async generate(data: GeneratePayrollInput) {
        const employee = await prisma.employees.findUnique({ where: { id: data.employee_id } });
        if (!employee) throw AppError.notFound("Employee");

        const monthStart = new Date(
            Date.UTC(data.month.getUTCFullYear(), data.month.getUTCMonth(), 1),
        );
        const monthEnd = new Date(
            Date.UTC(data.month.getUTCFullYear(), data.month.getUTCMonth() + 1, 1),
        );

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
        const { adjustment_percent, fixed_wage, allowance, total_pay } = computePay(
            employee.reference_salary,
            score_sum,
        );

        return prisma.payrollRecord.create({
            data: {
                employee_id: data.employee_id,
                month: monthStart,
                reference_salary: employee.reference_salary,
                fixed_wage,
                score_sum,
                adjustment_percent,
                allowance,
                total_pay,
            },
        });
    },
};
