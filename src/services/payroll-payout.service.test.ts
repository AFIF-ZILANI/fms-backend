import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { EmployeePayoutAccountService } from "./employee-payout-account.service";
import { PayrollPayoutService } from "./payroll-payout.service";
import { PaymentInstrumentService } from "./payment-instrument.service";
import {
    createPayrollPayoutSchema,
    markPaidSchema,
} from "@validators/payroll-payout.validator";

const mobile = () => `+880${Math.floor(1e9 + Math.random() * 8e9)}`;
let employeeId: string;
let profileId: string;
let instrumentId: string;
// Stands in for the session actor the controller stamps on.
let approverId: string;
const recordIds: string[] = [];
const bareEmployeeIds: string[] = [];
const bareIds: string[] = [];

async function newPayrollRecord(month: Date) {
    const record = await prisma.payrollRecord.create({
        data: {
            employee_id: employeeId,
            month,
            reference_salary: 15000,
            fixed_wage: 13500,
            score_sum: 0,
            adjustment_percent: 0,
            allowance: 1500,
            total_pay: 15000,
        },
    });
    recordIds.push(record.id);
    return record;
}

describe("Payout APIs", () => {
    beforeAll(async () => {
        const profile = await prisma.profiles.create({
            data: { name: "Payout Worker", mobile: mobile(), role: "EMPLOYEE" },
        });
        profileId = profile.id;
        const employee = await prisma.employees.create({
            data: {
                profile_id: profile.id,
                role: "WORKER",
                reference_salary: 15000,
            },
        });
        employeeId = employee.id;

        const approver = await prisma.profiles.create({
            data: { name: "Payout Approver", mobile: mobile(), role: "ADMIN" },
        });
        approverId = approver.id;

        const instrument = await prisma.paymentInstrument.create({
            data: {
                owner_type: "ADMIN",
                owner_id: approverId,
                type: "MFS",
                label: "Test payroll wallet",
                mfs_type: "BKASH",
                mobile_no: mobile(),
            },
        });
        instrumentId = instrument.id;
    });

    afterAll(async () => {
        await prisma.auditLog.deleteMany({ where: { changed_by_id: approverId } });
        await prisma.payment.deleteMany({ where: { from_instrument_id: instrumentId } });
        await prisma.paymentInstrument.deleteMany({ where: { id: instrumentId } });
        await prisma.expense.deleteMany({ where: { recorded_by_id: approverId } });
        await prisma.payrollPayout.deleteMany({ where: { payroll_record_id: { in: recordIds } } });
        await prisma.payrollRecord.deleteMany({ where: { id: { in: recordIds } } });
        await prisma.employeePayoutAccount.deleteMany({ where: { employee_id: employeeId } });
        await prisma.employees.deleteMany({
            where: { id: { in: [employeeId, ...bareEmployeeIds] } },
        });
        await prisma.profiles.deleteMany({
            where: { id: { in: [profileId, approverId, ...bareIds] } },
        });
    });

    test("adding an account closes the one it replaces, rather than editing it", async () => {
        const first = await EmployeePayoutAccountService.create({
            employee_id: employeeId,
            method: "BKASH",
            account_name: "Payout Worker",
            account_number: "01711111111",
            verified_by_id: approverId,
        });
        expect(first!.active_to).toBeNull();
        // Approval is stamped from the session, so it is always recorded.
        expect(first!.verified_by_id).toBe(approverId);
        expect(first!.verified_at).not.toBeNull();

        const second = await EmployeePayoutAccountService.create({
            employee_id: employeeId,
            method: "BKASH",
            account_name: "Payout Worker",
            account_number: "01722222222",
            verified_by_id: approverId,
        });

        const reloadedFirst = await EmployeePayoutAccountService.getById(first!.id);
        expect(reloadedFirst.active_to).not.toBeNull(); // closed, not overwritten
        expect(reloadedFirst.account_number).toBe("01711111111"); // history intact
        expect(second!.active_to).toBeNull();

        const active = await EmployeePayoutAccountService.getActiveFor(employeeId);
        expect(active!.id).toBe(second!.id);
    });

    test("a payout snapshots the active account's method and number", async () => {
        const record = await newPayrollRecord(new Date(Date.UTC(2026, 0, 1)));
        const payout = await PayrollPayoutService.create({ payroll_record_id: record.id });

        expect(payout!.method).toBe("BKASH");
        expect(payout!.account_number).toBe("01722222222");
        expect(payout!.amount.toNumber()).toBe(15000); // defaults to the record's total pay
        expect(payout!.status).toBe("PENDING");
    });

    test("a second payout for the same payroll record is a conflict", async () => {
        const record = await newPayrollRecord(new Date(Date.UTC(2026, 1, 1)));
        await PayrollPayoutService.create({ payroll_record_id: record.id });
        await expect(
            PayrollPayoutService.create({ payroll_record_id: record.id }),
        ).rejects.toMatchObject({ status: 409 });
    });

    test("a payout can't be marked paid without a transaction reference", async () => {
        const record = await newPayrollRecord(new Date(Date.UTC(2026, 2, 1)));
        const payout = await PayrollPayoutService.create({ payroll_record_id: record.id });

        expect(markPaidSchema.safeParse({ transaction_ref: "" }).success).toBe(false);

        const paid = await PayrollPayoutService.markPaid(payout!.id, {
            transaction_ref: "BKA7X9QZ12",
            paid_by_id: approverId,
            from_instrument_id: instrumentId,
        });
        expect(paid.status).toBe("CONFIRMED");
        expect(paid.paid_at).not.toBeNull();
    });

    test("cash is not a payout method, and a payout with no account is refused", async () => {
        // The request can't name a destination or an amount: they are dropped on the way in,
        // so a client can't redirect a payout or pay a different figure than the record.
        expect(
            createPayrollPayoutSchema.parse({
                payroll_record_id: crypto.randomUUID(),
                method: "CASH",
                account_number: "CASH",
                amount: 1,
            }),
        ).toEqual({ payroll_record_id: expect.any(String) });

        // An employee with nothing on file can't be paid at all now.
        const bareProfile = await prisma.profiles.create({
            data: { name: "No Account Worker", mobile: mobile(), role: "EMPLOYEE" },
        });
        bareIds.push(bareProfile.id);
        const bare = await prisma.employees.create({
            data: {
                profile_id: bareProfile.id,
                role: "WORKER",
                reference_salary: 9000,
            },
        });
        bareEmployeeIds.push(bare.id);
        const record = await prisma.payrollRecord.create({
            data: {
                employee_id: bare.id,
                month: new Date(Date.UTC(2026, 3, 1)),
                reference_salary: 9000,
                fixed_wage: 8100,
                score_sum: 0,
                adjustment_percent: 0,
                allowance: 900,
                total_pay: 9000,
            },
        });
        recordIds.push(record.id);

        await expect(
            PayrollPayoutService.create({ payroll_record_id: record.id }),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("a third-party account records whose it is", async () => {
        const { createPayoutAccountSchema } = await import(
            "@validators/employee-payout-account.validator"
        );
        const parsed = createPayoutAccountSchema.safeParse({
            employee_id: employeeId,
            method: "BKASH",
            account_name: "Spouse Name",
            account_number: "01733333333",
            holder_relation: "Spouse",
        });
        expect(parsed.success).toBe(true);
    });

    test("the transfer fee is derived, snapshotted, and expensed on confirm", async () => {
        const record = await newPayrollRecord(new Date(Date.UTC(2026, 5, 1)));
        const payout = await PayrollPayoutService.create({ payroll_record_id: record.id });

        // BKASH send-money is a flat charge, so it doesn't scale with the wage.
        const { PAYOUT_FEES } = await import("@lib/payout-fees");
        const expected = PAYOUT_FEES.BKASH.flat + (15000 * PAYOUT_FEES.BKASH.percent) / 100;
        expect(payout!.fee_paid_by_farm.toNumber()).toBe(expected);
        // The employee is still owed the whole contract figure -- the fee is on top.
        expect(payout!.amount.toNumber()).toBe(15000);

        const before = await PaymentInstrumentService.getBalance(instrumentId);
        await PayrollPayoutService.markPaid(payout!.id, {
            transaction_ref: "BKA5F5F5",
            paid_by_id: approverId,
            from_instrument_id: instrumentId,
        });

        const expenses = await prisma.expense.findMany({
            where: { remarks: { contains: payout!.id } },
            orderBy: { category: "asc" },
        });
        // Both books, off one confirm: the wage and the fee as cost...
        expect(expenses.map((e) => [e.category, e.amount.toNumber()])).toEqual([
            ["SALARY", 15000],
            ["SALARY_TRANSFER_FEE", expected],
        ]);
        expect(expenses.every((e) => e.cost_type === "SHARED_PERIOD")).toBe(true);

        // ...and one cash row for what actually left the wallet, wage + fee.
        const payments = await prisma.payment.findMany({ where: { ref_id: payout!.id } });
        expect(payments).toHaveLength(1);
        expect(payments[0]!.ref_type).toBe("PAYROLL");
        expect(payments[0]!.direction).toBe("OUTGOING");
        expect(payments[0]!.amount.toNumber()).toBe(15000 + expected);
        expect(payments[0]!.from_instrument_id).toBe(instrumentId);

        // Confirming money out is on the permanent record, against whoever confirmed it.
        const audit = await prisma.auditLog.findMany({
            where: { table_name: "PayrollPayout", record_id: payout!.id },
        });
        expect(audit).toHaveLength(1);
        expect(audit[0]).toMatchObject({ note: "Payout confirmed", changed_by_id: approverId });
        expect(audit[0]!.after_data).toMatchObject({ transaction_ref: "BKA5F5F5", method: "BKASH" });

        // The wallet is poorer by exactly that, which is the hole this closed.
        const after = await PaymentInstrumentService.getBalance(instrumentId);
        expect(before.balance.minus(after.balance).toNumber()).toBe(15000 + expected);
    });

    test("a double-submitted confirm pays once", async () => {
        const record = await newPayrollRecord(new Date(Date.UTC(2026, 6, 1)));
        const payout = await PayrollPayoutService.create({ payroll_record_id: record.id });
        const confirm = () =>
            PayrollPayoutService.markPaid(payout!.id, {
                transaction_ref: "BKA-DOUBLE",
                paid_by_id: approverId,
                from_instrument_id: instrumentId,
            });

        const results = await Promise.allSettled([confirm(), confirm()]);
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

        // One wage, one fee, one cash row -- not two of each.
        const payments = await prisma.payment.findMany({ where: { ref_id: payout!.id } });
        expect(payments).toHaveLength(1);
        const expenses = await prisma.expense.findMany({
            where: { remarks: { contains: payout!.id } },
        });
        expect(expenses.map((e) => e.category).sort()).toEqual(["SALARY", "SALARY_TRANSFER_FEE"]);
    });

    test("a wage expense can't also be paid through a generic Payment", async () => {
        const { PaymentService } = await import("./payment.service");
        const record = await newPayrollRecord(new Date(Date.UTC(2026, 7, 1)));
        const payout = await PayrollPayoutService.create({ payroll_record_id: record.id });
        await PayrollPayoutService.markPaid(payout!.id, {
            transaction_ref: "BKA-WAGE",
            paid_by_id: approverId,
            from_instrument_id: instrumentId,
        });
        const wage = await prisma.expense.findFirstOrThrow({
            where: { remarks: { contains: payout!.id }, category: "SALARY" },
        });

        await expect(
            PaymentService.create({
                amount: 100,
                payment_date: new Date(),
                ref_type: "EXPENSE",
                ref_id: wage.id,
                from_instrument_id: instrumentId,
            }),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("a salary payment can't be authored through the generic Payment endpoint", async () => {
        const { createPaymentSchema } = await import("@validators/payment.validator");
        // PayrollPayout stays the only way to pay a wage -- it is the only one
        // that can refuse to confirm without proof of transfer.
        expect(
            createPaymentSchema.safeParse({
                amount: 15000,
                payment_date: new Date(),
                ref_type: "PAYROLL",
                ref_id: crypto.randomUUID(),
                from_instrument_id: crypto.randomUUID(),
            }).success,
        ).toBe(false);
    });

    test("a confirmed payout can't then be marked failed", async () => {
        const record = await newPayrollRecord(new Date(Date.UTC(2026, 4, 1)));
        const payout = await PayrollPayoutService.create({ payroll_record_id: record.id });
        await PayrollPayoutService.markPaid(payout!.id, {
            transaction_ref: "BKA111",
            paid_by_id: approverId,
            from_instrument_id: instrumentId,
        });

        await expect(
            PayrollPayoutService.markFailed(payout!.id, { reason: "changed my mind" }),
        ).rejects.toMatchObject({ status: 400 });
    });
});
