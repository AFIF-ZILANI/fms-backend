import prisma from "@lib/db";
import { PAYOUT_FEES, transferFee } from "@lib/payout-fees";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { audit } from "@lib/audit";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type { Prisma } from "../../prisma/generated/prisma/client";
import type {
    CreatePayrollPayoutInput,
    FailPayoutInput,
    ListPayrollPayoutsQuery,
    MarkPaidInput,
} from "@validators/payroll-payout.validator";

/** Created on first use rather than seeded -- nothing else has to be set up
 *  before the first payroll can be paid. The wage and a bonus are different costs, the
 *  transfer fee is the same either way. */
const SALARY = "SALARY";
const FESTIVAL_BONUS = "FESTIVAL_BONUS";
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
    bonus: {
        select: {
            id: true,
            amount: true,
            event: { select: { id: true, name: true } },
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
                OR: [
                    { payroll_record: { employee_id: query.employee_id } },
                    { bonus: { employee_id: query.employee_id } },
                ],
            }),
        };
        const [payouts, total] = await Promise.all([
            prisma.employeePayout.findMany({
                where,
                include,
                orderBy: { created_at: "desc" },
                ...toSkipTake(query),
            }),
            prisma.employeePayout.count({ where }),
        ]);
        return { payouts, meta: buildMeta(total, query) };
    },

    async getById(id: string) {
        const payout = await prisma.employeePayout.findUnique({ where: { id }, include });
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
        // What is being paid: a month's wage or a festival bonus. Either way the amount is the
        // record's own, never the request's.
        let employee_id: string;
        let amount: Prisma.Decimal;
        let link: { payroll_record_id: string } | { bonus_id: string };
        if (data.payroll_record_id !== undefined) {
            const record = await prisma.payrollRecord.findUnique({
                where: { id: data.payroll_record_id },
                include: { payout: true },
            });
            if (!record) throw AppError.notFound("Payroll record");
            if (record.payout) {
                throw AppError.conflict("This payroll record already has a payout");
            }
            employee_id = record.employee_id;
            amount = record.total_pay;
            link = { payroll_record_id: record.id };
        } else {
            const bonus = await prisma.bonus.findUnique({
                where: { id: data.bonus_id! },
                include: { payout: true },
            });
            if (!bonus) throw AppError.notFound("Bonus");
            if (bonus.payout) {
                throw AppError.conflict("This bonus already has a payout");
            }
            employee_id = bonus.employee_id;
            amount = bonus.amount;
            link = { bonus_id: bonus.id };
        }

        // The destination is only ever an account on file: the one named, else the
        // employee's active one. A closed account is no destination.
        const account = data.payout_account_id
            ? await prisma.employeePayoutAccount.findUnique({
                  where: { id: data.payout_account_id },
              })
            : await prisma.employeePayoutAccount.findFirst({
                  where: { employee_id, active_to: null },
                  orderBy: { active_from: "desc" },
              });
        if (!account || account.active_to) {
            throw AppError.badRequest(
                "No active payout account on file for this employee -- add one before paying",
            );
        }
        if (account.employee_id !== employee_id) {
            throw AppError.badRequest("That payout account belongs to a different employee");
        }

        // The fee is derived from the destination and the amount, never sent by
        // the client -- and snapshotted here, because the published rate will
        // have moved on by the time anyone reads this row back.
        const { method, account_number } = account;
        try {
            return await prisma.employeePayout.create({
                data: {
                    ...link,
                    method,
                    account_number,
                    amount,
                    payout_account_id: account.id,
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
        const payout = await prisma.employeePayout.findUnique({ where: { id } });
        if (!payout) throw AppError.notFound("Payout");

        const instrument = await prisma.paymentInstrument.findUnique({
            where: { id: data.from_instrument_id },
        });
        if (!instrument) throw AppError.notFound("PaymentInstrument");
        if (!instrument.is_active) {
            throw AppError.badRequest("That account is inactive -- pick the one the money left");
        }

        const paid_at = data.paid_at ?? new Date();

        return prisma.$transaction(async (tx) => {
            // Claim the payout first. A concurrent second confirm blocks on this row's
            // lock, re-checks the condition, matches nothing, and aborts before it can
            // write a second wage, fee and Payment.
            const claimed = await tx.employeePayout.updateMany({
                where: { id, status: { not: "CONFIRMED" } },
                data: {
                    status: "CONFIRMED",
                    paid_at,
                    transaction_ref: data.transaction_ref,
                    paid_by_id: data.paid_by_id,
                },
            });
            if (claimed.count === 0) throw AppError.badRequest("Payout is already confirmed");
            await audit(tx, {
                table: "EmployeePayout",
                record_id: id,
                action: "UPDATE",
                actor_id: data.paid_by_id,
                note: "Payout confirmed",
                after: {
                    amount: payout.amount.toString(),
                    fee: payout.fee_paid_by_farm.toString(),
                    method: payout.method,
                    transaction_ref: data.transaction_ref,
                },
            });

            // Confirming a payout is the moment it becomes real money, so this is
            // where it enters both books: the wage and the fee as cost, and one
            // Payment for the cash that actually left the wallet. Neither is
            // written on create -- an unpaid payout has cost nothing yet.
            // docs/payroll-ledger-bridge.md
            // A bonus is a different cost from a wage; both are farm-wide and recurring.
            const isBonus = payout.bonus_id !== null;
            const category = isBonus ? FESTIVAL_BONUS : SALARY;
            await tx.expenseCategoryLookup.upsert({
                where: { code: category },
                update: {},
                create: { code: category, label: isBonus ? "Festival bonus" : "Salary" },
            });
            await tx.expense.create({
                data: {
                    category,
                    // Farm-wide and recurring. Not DIRECT: a PayrollRecord has no
                    // batch, and shed labour spans whatever batches are running,
                    // so batch P&L leaves it unallocated until bird-days (v2).
                    cost_type: "SHARED_PERIOD",
                    amount: payout.amount,
                    date: paid_at,
                    recorded_by_id: data.paid_by_id,
                    remarks: `${isBonus ? "Bonus" : "Wage"} on payout ${payout.id}`,
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
                    note: `${isBonus ? "Bonus" : "Wage"} + transfer fee, ${payout.method} ${payout.account_number}`,
                },
            });

            return tx.employeePayout.findUniqueOrThrow({ where: { id }, include });
        });
    },

    /** The transfer was attempted and bounced -- wrong wallet number, closed
     *  account. Kept as FAILED rather than deleted so the attempt is on record. */
    async markFailed(id: string, data: FailPayoutInput, actor_id?: string) {
        const payout = await prisma.employeePayout.findUnique({ where: { id } });
        if (!payout) throw AppError.notFound("Payout");

        // Conditional, so a confirm that lands first can never be overwritten.
        const claimed = await prisma.employeePayout.updateMany({
            where: { id, status: { not: "CONFIRMED" } },
            data: { status: "FAILED", transaction_ref: data.reason },
        });
        if (claimed.count === 0) {
            throw AppError.badRequest("A confirmed payout can't be marked failed");
        }
        if (actor_id) {
            await audit(prisma, {
                table: "EmployeePayout",
                record_id: id,
                action: "UPDATE",
                actor_id,
                note: "Payout marked failed",
                after: { reason: data.reason },
            });
        }
        return prisma.employeePayout.findUniqueOrThrow({ where: { id }, include });
    },
};
