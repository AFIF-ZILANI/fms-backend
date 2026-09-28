import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { EmployeePayoutAccountService } from "./employee-payout-account.service";
import { PayrollPayoutService } from "./payroll-payout.service";

const mobile = () => `+880${Math.floor(1e9 + Math.random() * 8e9)}`;
let employeeId: string;
let profileId: string;
const recordIds: string[] = [];

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
                fixed_wage: 13500,
            },
        });
        employeeId = employee.id;
    });

    afterAll(async () => {
        await prisma.payrollPayout.deleteMany({ where: { payroll_record_id: { in: recordIds } } });
        await prisma.payrollRecord.deleteMany({ where: { id: { in: recordIds } } });
        await prisma.employeePayoutAccount.deleteMany({ where: { employee_id: employeeId } });
        await prisma.employees.delete({ where: { id: employeeId } });
        await prisma.profiles.delete({ where: { id: profileId } });
    });

    test("adding an account closes the one it replaces, rather than editing it", async () => {
        const first = await EmployeePayoutAccountService.create({
            employee_id: employeeId,
            method: "BKASH",
            account_name: "Payout Worker",
            account_number: "01711111111",
        });
        expect(first!.active_to).toBeNull();

        const second = await EmployeePayoutAccountService.create({
            employee_id: employeeId,
            method: "BKASH",
            account_name: "Payout Worker",
            account_number: "01722222222",
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

    test("an electronic payout can't be marked paid without a transaction reference", async () => {
        const record = await newPayrollRecord(new Date(Date.UTC(2026, 2, 1)));
        const payout = await PayrollPayoutService.create({ payroll_record_id: record.id });

        await expect(
            PayrollPayoutService.markPaid(payout!.id, { receipt_doc_url: "https://x.test/r.pdf" }),
        ).rejects.toMatchObject({ status: 400 });

        const paid = await PayrollPayoutService.markPaid(payout!.id, {
            transaction_ref: "BKA7X9QZ12",
        });
        expect(paid.status).toBe("CONFIRMED");
        expect(paid.paid_at).not.toBeNull();
    });

    test("a cash payout needs a signed receipt, and a reference won't do", async () => {
        const record = await newPayrollRecord(new Date(Date.UTC(2026, 3, 1)));
        const payout = await PayrollPayoutService.create({
            payroll_record_id: record.id,
            method: "CASH",
            account_number: "CASH",
        });

        await expect(
            PayrollPayoutService.markPaid(payout!.id, { transaction_ref: "handed over" }),
        ).rejects.toMatchObject({ status: 400 });

        const paid = await PayrollPayoutService.markPaid(payout!.id, {
            receipt_doc_url: "https://docs.zerodfarms.test/receipt.pdf",
        });
        expect(paid.status).toBe("CONFIRMED");
    });

    test("a third-party account is refused without the holder's consent on file", async () => {
        const { createPayoutAccountSchema } = await import(
            "@validators/employee-payout-account.validator"
        );
        const parsed = createPayoutAccountSchema.safeParse({
            employee_id: employeeId,
            method: "BKASH",
            account_name: "Spouse Name",
            account_number: "01733333333",
            holder_relation: "spouse",
        });
        expect(parsed.success).toBe(false);
    });

    test("a confirmed payout can't then be marked failed", async () => {
        const record = await newPayrollRecord(new Date(Date.UTC(2026, 4, 1)));
        const payout = await PayrollPayoutService.create({ payroll_record_id: record.id });
        await PayrollPayoutService.markPaid(payout!.id, { transaction_ref: "BKA111" });

        await expect(
            PayrollPayoutService.markFailed(payout!.id, { reason: "changed my mind" }),
        ).rejects.toMatchObject({ status: 400 });
    });
});
