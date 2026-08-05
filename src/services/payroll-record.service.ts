import prisma from "@lib/db";
import { Prisma } from "../../prisma/generated/prisma/client";
import { AppError } from "@lib/app-error";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type {
    GeneratePayrollInput,
    ListPayrollRecordsQuery,
} from "@validators/payroll-record.validator";

const CLAMP_MIN = -10;
const CLAMP_MAX = 20;

// PayrollRecord is a locked snapshot -- no update, ever (employee-payroll-
// design.md: even if Employees.salary or a criterion's point value changes
// later, past months' actual pay stays correct and auditable).
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
     * month's PerformanceScoreEntry points, clamps to [-10, +20], applies
     * to the employee's current baseline salary, locks the result. */
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
            where: { employee_id: data.employee_id, date: { gte: monthStart, lt: monthEnd } },
        });
        const score_sum = entries.reduce((sum, e) => sum + e.points, 0);
        const adjustment_percent = Math.max(CLAMP_MIN, Math.min(CLAMP_MAX, score_sum));

        const baseline_salary = employee.salary;
        const final_salary = baseline_salary
            .times(
                new Prisma.Decimal(1).plus(new Prisma.Decimal(adjustment_percent).dividedBy(100)),
            )
            .toDecimalPlaces(2);

        return prisma.payrollRecord.create({
            data: {
                employee_id: data.employee_id,
                month: monthStart,
                baseline_salary,
                score_sum,
                adjustment_percent,
                final_salary,
            },
        });
    },
};
