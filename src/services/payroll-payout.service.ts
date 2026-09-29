import prisma from "@lib/db";
import { PAYOUT_FEES, transferFee } from "@lib/payout-fees";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type {
    CreatePayrollPayoutInput,
    FailPayoutInput,
    ListPayrollPayoutsQuery,
    MarkPaidInput,
} from "@validators/payroll-payout.validator";

/** Created on first use rather than seeded -- nothing else has to be set up
 *  before the first payroll can be paid. */
const SALARY_TRANSFER_FEE = "SALARY_TRANSFER_FEE";

const include = {
    payroll_record: {
        select: {
            id: true,
            month: true,
            total_pay: true,
            employee: { select: { id: true, profile: { select: { name: true } } } },
        },
    },
    paid_by: { select: { id: true, name: true } },
} as const;

export const PayrollPayoutService = {
    /** The published rates the modal previews the fee with, so the figure the
     *  user sees and the figure that gets stored come from one table. */
    feeRates() {
        return PAYOUT_FEES;
    },


    async getAll(query: ListPayrollPayoutsQuery) {
        const where = {
            ...(query.status !== undefined && { status: query.status }),
            ...(query.employee_id !== undefined && {
                payroll_record: { employee_id: query.employee_id },
            }),
        };
        const [payouts, total] = await Promise.all([
            prisma.payrollPayout.findMany({
                where,
                include,
                orderBy: { created_at: "desc" },
                ...toSkipTake(query),
            }),
            prisma.payrollPayout.count({ where }),
        ]);
        return { payouts, meta: buildMeta(total, query) };
    },

    async getById(id: string) {
        const payout = await prisma.payrollPayout.findUnique({ where: { id }, include });
        if (!payout) throw AppError.notFound("Payout");
        return payout;
    },

    /**
     * Opens a payout against a generated payroll record. Method and account
     * number are snapshotted off the employee's active account: that account can
     * later be closed and superseded, but the payout has to keep showing where
     * the money actually went.
     */
    async create(data: CreatePayrollPayoutInput) {
        const record = await prisma.payrollRecord.findUnique({
            where: { id: data.payroll_record_id },
            include: { payout: true },
        });
        if (!record) throw AppError.notFound("Payroll record");
        if (record.payout) {
            throw AppError.conflict("This payroll record already has a payout");
        }

        // The fallback is only for a caller that named no destination at all.
        // A caller that named a method means it -- linking their active bank
        // account to a CASH payout would misstate where the money went.
        const account = data.payout_account_id
            ? await prisma.employeePayoutAccount.findUnique({
                  where: { id: data.payout_account_id },
              })
            : data.method
              ? null
              : await prisma.employeePayoutAccount.findFirst({
                    where: { employee_id: record.employee_id, active_to: null },
                    orderBy: { active_from: "desc" },
                });

        // A method and account number have to come from somewhere, and with cash
        // gone that somewhere is an account on file.
        const method = data.method ?? account?.method;
        const account_number = data.account_number ?? account?.account_number;
        if (!method || !account_number) {
            throw AppError.badRequest(
                "No payout account on file for this employee -- add one before paying this payroll",
            );
        }
        if (account && account.employee_id !== record.employee_id) {
            throw AppError.badRequest("That payout account belongs to a different employee");
        }

        // The fee is derived from the destination and the amount, never sent by
        // the client -- and snapshotted here, because the published rate will
        // have moved on by the time anyone reads this row back.
        const amount = data.amount ?? record.total_pay;
        try {
            return await prisma.payrollPayout.create({
                data: {
                    payroll_record_id: record.id,
                    method,
                    account_number,
                    amount,
                    ...(account && { payout_account_id: account.id }),
                    fee_paid_by_farm: transferFee(method, amount),
                },
                include,
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    /**
     * The rule the whole model exists for: no payout is marked paid without the
     * transaction reference from the transfer.
     */
    async markPaid(id: string, data: MarkPaidInput) {
        const payout = await prisma.payrollPayout.findUnique({ where: { id } });
        if (!payout) throw AppError.notFound("Payout");
        if (payout.status === "CONFIRMED") {
            throw AppError.badRequest("Payout is already confirmed");
        }

        const paid_at = data.paid_at ?? new Date();

        return prisma.$transaction(async (tx) => {
            // The fee the farm absorbed is an operating cost, so it belongs in
            // the P&L and not only on the payout. Written here rather than on
            // create: an unpaid payout has cost nothing yet.
            if (payout.fee_paid_by_farm.greaterThan(0)) {
                await tx.expenseCategoryLookup.upsert({
                    where: { code: SALARY_TRANSFER_FEE },
                    update: {},
                    create: { code: SALARY_TRANSFER_FEE, label: "Salary transfer fee" },
                });
                await tx.expense.create({
                    data: {
                        category: SALARY_TRANSFER_FEE,
                        // Farm-wide and recurring, traceable to no single batch.
                        cost_type: "SHARED_PERIOD",
                        amount: payout.fee_paid_by_farm,
                        date: paid_at,
                        recorded_by_id: data.paid_by_id,
                        remarks: `${payout.method} transfer fee on payout ${payout.id}`,
                    },
                });
            }

            return tx.payrollPayout.update({
                where: { id },
                data: {
                    status: "CONFIRMED",
                    paid_at,
                    transaction_ref: data.transaction_ref,
                    paid_by_id: data.paid_by_id,
                },
                include,
            });
        });
    },

    /** The transfer was attempted and bounced -- wrong wallet number, closed
     *  account. Kept as FAILED rather than deleted so the attempt is on record. */
    async markFailed(id: string, data: FailPayoutInput) {
        const payout = await prisma.payrollPayout.findUnique({ where: { id } });
        if (!payout) throw AppError.notFound("Payout");
        if (payout.status === "CONFIRMED") {
            throw AppError.badRequest("A confirmed payout can't be marked failed");
        }

        return prisma.payrollPayout.update({
            where: { id },
            data: { status: "FAILED", transaction_ref: data.reason },
            include,
        });
    },
};
