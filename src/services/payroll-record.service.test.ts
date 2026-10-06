import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { PerformanceScoreEntryService } from "./performance-score-entry.service";
import { PayrollPayoutService } from "./payroll-payout.service";
import { PayrollRecordService } from "./payroll-record.service";
import { EmployeeService } from "./employee.service";
import { EmployeePayoutAccountService } from "./employee-payout-account.service";

let profileId: string;
let instrumentId: string;
const createdEmployeeIds: string[] = [];
const recordIdsToClean: string[] = [];
const createdProfileIds: string[] = [];

async function newEmployee(salary: number) {
    const profile = await prisma.profiles.create({
        data: {
            name: "Payroll Test",
            mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
            role: "EMPLOYEE",
        },
    });
    createdProfileIds.push(profile.id);
    const employee = await prisma.employees.create({
        data: {
            profile_id: profile.id,
            role: "WORKER",
            reference_salary: salary,
        },
    });
    createdEmployeeIds.push(employee.id);
    return employee;
}

describe("PayrollRecordService", () => {
    beforeAll(async () => {
        const giver = await prisma.profiles.create({
            data: {
                name: "Payroll Giver",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "ADMIN",
            },
        });
        profileId = giver.id;

        const instrument = await prisma.paymentInstrument.create({
            data: {
                owner_type: "ADMIN",
                owner_id: profileId,
                type: "MFS",
                label: "Test payroll wallet",
                mfs_type: "BKASH",
                mobile_no: `018${Date.now().toString().slice(-8)}`,
            },
        });
        instrumentId = instrument.id;
    });

    afterAll(async () => {
        // Confirming a payout writes a transfer-fee expense against the actor,
        // so it has to go before the profile it points at.
        await prisma.payment.deleteMany({ where: { from_instrument_id: instrumentId } });
        await prisma.paymentInstrument.deleteMany({ where: { id: instrumentId } });
        await prisma.expense.deleteMany({ where: { recorded_by_id: profileId } });
        // Payouts reference payroll records, so they go first.
        await prisma.payrollPayout.deleteMany({
            where: { payroll_record: { employee_id: { in: createdEmployeeIds } } },
        });
        await prisma.payrollRecord.deleteMany({
            where: {
                OR: [{ employee_id: { in: createdEmployeeIds } }, { id: { in: recordIdsToClean } }],
            },
        });
        await prisma.employeePayoutAccount.deleteMany({
            where: { employee_id: { in: createdEmployeeIds } },
        });
        await prisma.performanceScoreEntry.deleteMany({
            where: { employee_id: { in: createdEmployeeIds } },
        });
        await prisma.employees.deleteMany({ where: { id: { in: createdEmployeeIds } } });
        await prisma.profiles.deleteMany({
            where: { id: { in: [...createdProfileIds, profileId] } },
        });
    });

    // "Great month" from employee-payroll-design.md worked examples,
    // baseline 15000: attendance(+3) + suggestion(+3) + accurate logging(+2)
    // = +8 raw sum, +8% adjustment, final 16200.
    test("great month: +8 sum clamps to +8%, final salary 16200 on 15000 baseline", async () => {
        const employee = await newEmployee(15000);
        const month = new Date("2026-03-15T00:00:00Z");

        for (const criterion of [
            "ATTENDANCE_PERFECT",
            "SUGGESTION_IMPLEMENTED",
            "ACCURATE_DATA_ENTRY",
        ] as const) {
            await PerformanceScoreEntryService.create({
                employee_id: employee.id,
                given_by_id: profileId,
                criterion,
                reason: "worked example",
                incident_date: month,
                // Entries at -4 or worse need written notice on file first; the
                // positive criteria ignore it.
                notice_doc_url: "https://docs.zerodfarms.test/notice.pdf",
            });
        }

        const record = await PayrollRecordService.generate({ employee_id: employee.id, month });
        expect(record.score_sum).toBe(8);
        expect(record.adjustment_percent).toBe(8);
        expect(record.total_pay.toNumber()).toBe(16200);
    });

    // "Bad month": biosecurity violation(-4) + negligent loss(-5) + equipment
    // damage(-3) = -12 raw, floored at -10%, final 13500.
    test("bad month: -12 sum floors at -10%, final salary 13500 on 15000 baseline", async () => {
        const employee = await newEmployee(15000);
        const month = new Date("2026-04-15T00:00:00Z");

        for (const criterion of [
            "BIOSECURITY_VIOLATION",
            "NEGLIGENT_LOSS",
            "EQUIPMENT_DAMAGE",
        ] as const) {
            await PerformanceScoreEntryService.create({
                employee_id: employee.id,
                given_by_id: profileId,
                criterion,
                reason: "worked example",
                incident_date: month,
                // Entries at -4 or worse need written notice on file first; the
                // positive criteria ignore it.
                notice_doc_url: "https://docs.zerodfarms.test/notice.pdf",
            });
        }

        const record = await PayrollRecordService.generate({ employee_id: employee.id, month });
        expect(record.score_sum).toBe(-12);
        expect(record.adjustment_percent).toBe(-10);
        expect(record.total_pay.toNumber()).toBe(13500);
    });

    // "Runaway great month": every positive criterion in one month sums to
    // exactly +24 raw, ceilinged at +20, total 18000. This used to stack six
    // OTHER entries of +4, which the ±5 monthly cap on OTHER now forbids --
    // the cap is the point, so the test earns its +24 honestly instead.
    test("runaway great month: +24 sum ceilings at +20%, total pay 18000 on R = 15000", async () => {
        const employee = await newEmployee(15000);
        const month = new Date("2026-05-15T00:00:00Z");

        for (const criterion of [
            "ATTENDANCE_PERFECT", // +3
            "EARLY_PROBLEM_REPORT", // +3
            "SUGGESTION_IMPLEMENTED", // +3
            "TEAM_TARGET_HIT", // +3
            "ZERO_NEGLIGENT_LOSS", // +2
            "ACCURATE_DATA_ENTRY", // +2
            "BIOSECURITY_FOLLOWED", // +2
            "HELPED_COWORKER", // +2
            "EXTRA_TASK_COMPLETED", // +2
            "CONFLICT_RESOLVED", // +2
        ] as const) {
            await PerformanceScoreEntryService.create({
                employee_id: employee.id,
                given_by_id: profileId,
                criterion,
                reason: "worked example",
                incident_date: month,
            });
        }

        const record = await PayrollRecordService.generate({ employee_id: employee.id, month });
        expect(record.score_sum).toBe(24);
        expect(record.adjustment_percent).toBe(20);
        expect(record.total_pay.toNumber()).toBe(18000);
    });

    test("regenerating the same employee+month throws a conflict", async () => {
        const employee = await newEmployee(10000);
        const month = new Date("2026-06-15T00:00:00Z");

        await PayrollRecordService.generate({ employee_id: employee.id, month });
        await expect(
            PayrollRecordService.generate({ employee_id: employee.id, month }),
        ).rejects.toMatchObject({ status: 409 });
    });

    test("a month with no score entries generates at 0% adjustment", async () => {
        const employee = await newEmployee(12000);
        const month = new Date("2026-07-15T00:00:00Z");

        const record = await PayrollRecordService.generate({ employee_id: employee.id, month });
        expect(record.score_sum).toBe(0);
        expect(record.adjustment_percent).toBe(0);
        expect(record.total_pay.toNumber()).toBe(12000);
    });

    test("payslip carries the wage split, the entries behind it, and a masked account", async () => {
        const employee = await newEmployee(15000);
        const month = new Date("2026-11-15T00:00:00Z");

        await PerformanceScoreEntryService.create({
            employee_id: employee.id,
            given_by_id: profileId,
            criterion: "ATTENDANCE_PERFECT",
            reason: "No unexcused absence",
            incident_date: month,
        });

        const record = await PayrollRecordService.generate({ employee_id: employee.id, month });
        // The destination is the account on file, never something the request names.
        await EmployeePayoutAccountService.create({
            employee_id: employee.id,
            method: "BKASH",
            account_name: "Payroll Test",
            account_number: "01712345678",
            verified_by_id: profileId,
        });
        const payout = await PayrollPayoutService.create({ payroll_record_id: record.id });
        await PayrollPayoutService.markPaid(payout!.id, {
            transaction_ref: "BKA9Z1",
            paid_by_id: profileId,
            from_instrument_id: instrumentId,
        });

        const slip = await PayrollRecordService.payslip(record.id);
        expect(slip.fixed_wage.toNumber()).toBe(13500);
        expect(slip.allowance.toNumber()).toBe(1950); // P = +3
        expect(slip.total_pay.toNumber()).toBe(15450);
        expect(slip.entries).toHaveLength(1);
        expect(slip.entries[0]!.reason).toBe("No unexcused absence");
        // The whole account number has no business being on a payslip response.
        expect(slip.payout!.account_last4).toBe("5678");
        expect(JSON.stringify(slip)).not.toContain("01712345678");
        expect(slip.payout!.status).toBe("CONFIRMED");
    });

    test("a voided entry drops off the payslip", async () => {
        const employee = await newEmployee(15000);
        const month = new Date("2026-12-15T00:00:00Z");

        const entry = await PerformanceScoreEntryService.create({
            employee_id: employee.id,
            given_by_id: profileId,
            criterion: "HELPED_COWORKER",
            reason: "credited to the wrong person",
            incident_date: month,
        });
        await PerformanceScoreEntryService.void(entry!.id, { void_reason: "wrong employee" });

        const record = await PayrollRecordService.generate({ employee_id: employee.id, month });
        const slip = await PayrollRecordService.payslip(record.id);
        expect(slip.entries).toHaveLength(0);
        expect(slip.score_sum).toBe(0);
    });

    test("the month an employee left in is still payable", async () => {
        const employee = await newEmployee(15000);
        await EmployeeService.terminate(employee.id);

        // Terminated today, so this month's wage is still owed.
        const record = await PayrollRecordService.generate({
            employee_id: employee.id,
            month: new Date(),
        });
        recordIdsToClean.push(record.id);
        expect(record.total_pay.toNumber()).toBe(15000);
    });

    test("payroll can't be generated for a month after the employee left", async () => {
        const employee = await newEmployee(15000);
        await EmployeeService.terminate(employee.id);

        const nextMonth = new Date();
        nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
        await expect(
            PayrollRecordService.generate({ employee_id: employee.id, month: nextMonth }),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("reinstating clears the block", async () => {
        const employee = await newEmployee(15000);
        await EmployeeService.terminate(employee.id);
        await EmployeeService.reinstate(employee.id);

        const nextMonth = new Date();
        nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
        const record = await PayrollRecordService.generate({
            employee_id: employee.id,
            month: nextMonth,
        });
        recordIdsToClean.push(record.id);
        expect(record.total_pay.toNumber()).toBe(15000);
    });

    test("an appointed employee and one on probation are both fully payable", async () => {
        for (const status of ["APPOINTED", "PROBATION"] as const) {
            const employee = await newEmployee(15000);
            await EmployeeService.update(employee.id, { employment_status: status });
            const record = await PayrollRecordService.generate({
                employee_id: employee.id,
                month: new Date("2026-01-15T00:00:00Z"),
            });
            recordIdsToClean.push(record.id);
            expect(record.total_pay.toNumber()).toBe(15000);
        }
    });

    test("an override is what gets paid; the role standard is ignored", async () => {
        const employee = await newEmployee(12000); // override, role standard is 15,000
        const month = new Date("2027-01-15T00:00:00Z");
        const record = await PayrollRecordService.generate({
            employee_id: employee.id,
            month,
        });
        recordIdsToClean.push(record.id);
        expect(record.reference_salary.toNumber()).toBe(12000);
        expect(record.fixed_wage.toNumber()).toBe(10800); // 0.9 x 12,000
        expect(record.total_pay.toNumber()).toBe(12000);
    });

    test("an employee with no override is paid their role's standard", async () => {
        const employee = await newEmployee(12000);
        // Drop the override so the role's figure has to be the one used.
        await prisma.employees.update({
            where: { id: employee.id },
            data: { reference_salary: null },
        });
        const role = await prisma.employeeRole.findUniqueOrThrow({
            where: { code: "WORKER" },
        });
        const month = new Date("2027-02-15T00:00:00Z");
        const record = await PayrollRecordService.generate({
            employee_id: employee.id,
            month,
        });
        recordIdsToClean.push(record.id);
        expect(record.reference_salary.toNumber()).toBe(role.reference_salary.toNumber());
    });
});
