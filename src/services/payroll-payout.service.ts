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
const SALARY = "SALARY";
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

        const instrument = await prisma.paymentInstrument.findUnique({
            where: { id: data.from_instrument_id },
        });
        if (!instrument) throw AppError.notFound("PaymentInstrument");
        if (!instrument.is_active) {
            throw AppError.badRequest("That account is inactive -- pick the one the money left");
        }

        const paid_at = data.paid_at ?? new Date();

        return prisma.$transaction(async (tx) => {
            // Confirming a payout is the moment it becomes real money, so this is
            // where it enters both books: the wage and the fee as cost, and one
            // Payment for the cash that actually left the wallet. Neither is
            // written on create -- an unpaid payout has cost nothing yet.
            // docs/payroll-ledger-bridge.md
            await tx.expenseCategoryLookup.upsert({
                where: { code: SALARY },
                update: {},
                create: { code: SALARY, label: "Salary" },
            });
            await tx.expense.create({
                data: {
                    category: SALARY,
                    // Farm-wide and recurring. Not DIRECT: a PayrollRecord has no
                    // batch, and shed labour spans whatever batches are running,
                    // so batch P&L leaves it unallocated until bird-days (v2).
                    cost_type: "SHARED_PERIOD",
                    amount: payout.amount,
                    date: paid_at,
                    recorded_by_id: data.paid_by_id,
                    remarks: `Wage on payout ${payout.id}`,
                },
            });

            if (payout.fee_paid_by_farm.greaterThan(0)) {
                await tx.expenseCategoryLookup.upsert({
                    where: { code: SALARY_TRANSFER_FEE },
                    update: {},
                    create: { code: SALARY_TRANSFER_FEE, label: "Salary transfer fee" },
                });
                await tx.expense.create({
                    data: {
                        category: SALARY_TRANSFER_FEE,
                        cost_type: "SHARED_PERIOD",
                        amount: payout.fee_paid_by_farm,
                        date: paid_at,
                        recorded_by_id: data.paid_by_id,
                        remarks: `${payout.method} transfer fee on payout ${payout.id}`,
                    },
                });
            }

            // One row, not one per expense: the cash left the wallet once, as the
            // wage plus the fee, and it references the payout that moved it so an
            // instrument statement lines up with the provider's own.
            // Written directly rather than through PaymentService.create, which
            // opens its own transaction -- and whose over-payment guard is moot
            // here, since a payout can only be confirmed once.
            await tx.payment.create({
                data: {
                    amount: payout.amount.plus(payout.fee_paid_by_farm),
                    payment_date: paid_at,
                    direction: "OUTGOING",
                    ref_type: "PAYROLL",
                    ref_id: payout.id,
                    from_instrument_id: data.from_instrument_id,
                    transaction_ref: data.transaction_ref,
                    handled_by_id: data.paid_by_id,
                    note: `Wage + transfer fee, ${payout.method} ${payout.account_number}`,
                },
            });

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
