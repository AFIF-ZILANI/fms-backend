import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import { defined } from "@lib/defined";
import { audit, last4 } from "@lib/audit";
import type {
    CreatePayoutAccountInput,
    ListPayoutAccountsQuery,
} from "@validators/employee-payout-account.validator";

const include = {
    verified_by: { select: { id: true, name: true } },
} as const;

export const EmployeePayoutAccountService = {
    async getAll(query: ListPayoutAccountsQuery) {
        const where = {
            ...(query.employee_id !== undefined && { employee_id: query.employee_id }),
            ...(query.active_only === "true" && { active_to: null }),
        };
        const [accounts, total] = await Promise.all([
            prisma.employeePayoutAccount.findMany({
                where,
                include,
                // Newest first, so the account in force leads the list.
                orderBy: { active_from: "desc" },
                ...toSkipTake(query),
            }),
            prisma.employeePayoutAccount.count({ where }),
        ]);
        return { accounts, meta: buildMeta(total, query) };
    },

    async getById(id: string) {
        const account = await prisma.employeePayoutAccount.findUnique({ where: { id }, include });
        if (!account) throw AppError.notFound("Payout account");
        return account;
    },

    /** The account an employee's wage is currently sent to, or null if none. */
    async getActiveFor(employee_id: string) {
        return prisma.employeePayoutAccount.findFirst({
            where: { employee_id, active_to: null },
            include,
            orderBy: { active_from: "desc" },
        });
    },

    /**
     * Append-only: adding an account closes whatever it replaces, in one
     * transaction. There is deliberately no update endpoint -- redirecting
     * someone's wage is the most attractive target in a payroll system, and an
     * in-place edit would leave no trace of where the money used to go.
     */
    async create(data: CreatePayoutAccountInput) {
        const employee = await prisma.employees.findUnique({ where: { id: data.employee_id } });
        if (!employee) throw AppError.notFound("Employee");

        const now = new Date();
        try {
            return await prisma.$transaction(async (tx) => {
                await tx.employeePayoutAccount.updateMany({
                    where: { employee_id: data.employee_id, active_to: null },
                    data: { active_to: now, closed_by_id: data.verified_by_id },
                });
                const account = await tx.employeePayoutAccount.create({
                    data: {
                        ...defined(data),
                        active_from: now,
                        // Who approved it comes from the session, so it is always
                        // known and the timestamp always goes with it.
                        verified_at: now,
                    },
                    include,
                });
                // Redirecting someone's wage is the most attractive target in payroll:
                // who pointed it where, and when, is exactly the question this answers.
                await audit(tx, {
                    table: "EmployeePayoutAccount",
                    record_id: account.id,
                    action: "CREATE",
                    actor_id: data.verified_by_id,
                    note: "Payout account added; any previous one closed",
                    after: {
                        employee_id: data.employee_id,
                        method: data.method,
                        account_last4: last4(data.account_number),
                    },
                });
                return account;
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    /** Closes an account without opening a replacement -- an employee leaving,
     *  or a wallet that stopped working. */
    async close(id: string, actor_id?: string) {
        const account = await prisma.employeePayoutAccount.findUnique({ where: { id } });
        if (!account) throw AppError.notFound("Payout account");
        if (account.active_to) throw AppError.badRequest("Account is already closed");

        const closed = await prisma.employeePayoutAccount.update({
            where: { id },
            data: {
                active_to: new Date(),
                ...(actor_id !== undefined && { closed_by_id: actor_id }),
            },
            include,
        });
        if (actor_id) {
            await audit(prisma, {
                table: "EmployeePayoutAccount",
                record_id: id,
                action: "UPDATE",
                actor_id,
                note: "Payout account closed",
                after: { account_last4: last4(account.account_number) },
            });
        }
        return closed;
    },
};
