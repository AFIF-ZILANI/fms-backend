import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { BonusEventService } from "./bonus-event.service";
import { PayrollPayoutService } from "./payroll-payout.service";
import { EmployeePayoutAccountService } from "./employee-payout-account.service";
import { EmployeeService } from "./employee.service";
import { PayrollRecordService } from "./payroll-record.service";
import { markPaidSchema } from "@validators/payroll-payout.validator";

// Event date fixed so service months are deterministic.
const EVENT_DATE = new Date("2026-07-15T00:00:00Z");
const mobile = () => `+880${Math.floor(1e9 + Math.random() * 8e9)}`;

let actorId: string;
let instrumentId: string;
const profileIds: string[] = [];
const employeeIds: string[] = [];
const eventIds: string[] = [];
const recordIds: string[] = [];

async function newEmployee(opts: {
    name: string;
    religion?: "ISLAM" | "HINDU" | null;
    joined: string;
    status?: "CONFIRMED" | "PROBATION" | "TERMINATED";
    salary?: number;
}) {
    const profile = await prisma.profiles.create({
        data: { name: opts.name, mobile: mobile(), role: "EMPLOYEE" },
    });
    profileIds.push(profile.id);
    const e = await prisma.employees.create({
        data: {
            profile_id: profile.id,
            role: "WORKER",
            reference_salary: opts.salary ?? 15000,
            joining_date: new Date(opts.joined),
            employment_status: opts.status ?? "CONFIRMED",
            religion: opts.religion ?? null,
        },
    });
    employeeIds.push(e.id);
    return e;
}

async function newEvent(over: Record<string, unknown> = {}) {
    const event = await BonusEventService.create(
        {
            name: `Eid test ${crypto.randomUUID().slice(0, 6)}`,
            event_date: EVENT_DATE,
            religion: "ISLAM",
            multiplier: 1,
            min_service_months: 12,
            prorate: true,
            ...over,
        },
        actorId,
    );
    eventIds.push(event!.id);
    return event!;
}

const rowFor = async (eventId: string, employeeId: string) =>
    (await BonusEventService.proposal(eventId)).rows.find((r) => r.employee_id === employeeId);

describe("festival bonus", () => {
    beforeAll(async () => {
        const actor = await prisma.profiles.create({
            data: { name: "Bonus Admin", mobile: mobile(), role: "ADMIN" },
        });
        actorId = actor.id;
        profileIds.push(actor.id);
        const instrument = await prisma.paymentInstrument.create({
            data: {
                owner_type: "ADMIN",
                owner_id: actorId,
                type: "MFS",
                label: "Bonus test wallet",
                mfs_type: "BKASH",
                mobile_no: mobile(),
            },
        });
        instrumentId = instrument.id;
    });

    afterAll(async () => {
        const bonuses = await prisma.bonus.findMany({
            where: { event_id: { in: eventIds } },
            select: { id: true },
        });
        const payouts = await prisma.employeePayout.findMany({
            where: { OR: [{ bonus_id: { in: bonuses.map((b) => b.id) } }, { payroll_record_id: { in: recordIds } }] },
            select: { id: true },
        });
        await prisma.payment.deleteMany({ where: { ref_id: { in: payouts.map((p) => p.id) } } });
        await prisma.paymentInstrument.deleteMany({ where: { id: instrumentId } });
        await prisma.expense.deleteMany({ where: { recorded_by_id: actorId } });
        await prisma.auditLog.deleteMany({ where: { changed_by_id: actorId } });
        await prisma.employeePayout.deleteMany({ where: { id: { in: payouts.map((p) => p.id) } } });
        await prisma.bonus.deleteMany({ where: { event_id: { in: eventIds } } });
        await prisma.bonusEvent.deleteMany({ where: { id: { in: eventIds } } });
        await prisma.payrollRecord.deleteMany({ where: { id: { in: recordIds } } });
        await prisma.employeePayoutAccount.deleteMany({ where: { employee_id: { in: employeeIds } } });
        await prisma.employees.deleteMany({ where: { id: { in: employeeIds } } });
        await prisma.profiles.deleteMany({ where: { id: { in: profileIds } } });
    });

    test("the proposal ticks, prorates and lists with a reason -- and drops the terminated", async () => {
        const full = await newEmployee({ name: "Full Service", religion: "ISLAM", joined: "2025-01-01" });
        const short = await newEmployee({ name: "Short Service", religion: "ISLAM", joined: "2025-11-15" });
        const other = await newEmployee({ name: "Other Faith", religion: "HINDU", joined: "2025-01-01" });
        const unknown = await newEmployee({ name: "No Religion", religion: null, joined: "2025-01-01" });
        const gone = await newEmployee({ name: "Left Farm", religion: "ISLAM", joined: "2025-01-01", status: "TERMINATED" });
        const event = await newEvent();

        const { rows } = await BonusEventService.proposal(event.id);
        const get = (id: string) => rows.find((r) => r.employee_id === id);

        expect(get(full.id)).toMatchObject({ selected: true, reason: null, service_months: 18 });
        expect(get(full.id)!.proposed_amount.toString()).toBe("15000");
        // 8 months -> 8/12 of R, still ticked
        expect(get(short.id)).toMatchObject({ selected: true, service_months: 8 });
        expect(get(short.id)!.proposed_amount.toString()).toBe("10000");
        expect(get(other.id)).toMatchObject({ selected: false, reason: "Different religion" });
        expect(get(unknown.id)).toMatchObject({ selected: false, reason: "Religion not recorded" });
        expect(get(gone.id)).toBeUndefined();
    });

    test("GET proposal writes nothing", async () => {
        await newEmployee({ name: "Read Only", religion: "ISLAM", joined: "2025-01-01" });
        const event = await newEvent();
        const counts = async () => [await prisma.bonus.count(), await prisma.bonusEvent.count(), await prisma.auditLog.count()];

        const before = await counts();
        await BonusEventService.proposal(event.id);
        await BonusEventService.proposal(event.id);
        expect(await counts()).toEqual(before);
    });

    test("granting snapshots salary and service months from the server, keeps the owner's adjusted amount", async () => {
        const e = await newEmployee({ name: "Adjusted", religion: "ISLAM", joined: "2025-01-01", salary: 20000 });
        const event = await newEvent({ multiplier: 1.5 });

        const [bonus] = (await BonusEventService.grant(
            event.id,
            { bonuses: [{ employee_id: e.id, amount: 25000, note: "Extra for the harvest" }] },
            actorId,
        ))!;

        expect(bonus!.amount.toString()).toBe("25000"); // owner's figure, not the proposed 30000
        expect(bonus!.reference_salary.toString()).toBe("20000"); // computed here
        expect(bonus!.service_months).toBe(18);
        expect(bonus!.note).toBe("Extra for the harvest");
        const row = await rowFor(event.id, e.id);
        expect(row).toMatchObject({ already_granted: true, selected: false });
    });

    test("one bonus per employee per event; terminated, unknown and repeated employees are refused", async () => {
        const e = await newEmployee({ name: "Once Only", religion: "ISLAM", joined: "2025-01-01" });
        const gone = await newEmployee({ name: "Gone", religion: "ISLAM", joined: "2025-01-01", status: "TERMINATED" });
        const event = await newEvent();
        const grant = (ids: string[]) =>
            BonusEventService.grant(event.id, { bonuses: ids.map((employee_id) => ({ employee_id, amount: 100 })) }, actorId);

        await grant([e.id]);
        await expect(grant([e.id])).rejects.toMatchObject({ status: 409 });
        await expect(grant([gone.id])).rejects.toMatchObject({ status: 400 });
        await expect(grant([crypto.randomUUID()])).rejects.toMatchObject({ status: 404 });
        await expect(grant([e.id, e.id])).rejects.toMatchObject({ status: 400 });
    });

    test("a bonus is paid through the payout path: FESTIVAL_BONUS expense, one Payment, proof required", async () => {
        const e = await newEmployee({ name: "Paid Bonus", religion: "ISLAM", joined: "2025-01-01" });
        await EmployeePayoutAccountService.create({
            employee_id: e.id,
            method: "BKASH",
            account_name: "Paid Bonus",
            account_number: "01755555555",
            verified_by_id: actorId,
        });
        const event = await newEvent();
        const [bonus] = (await BonusEventService.grant(event.id, { bonuses: [{ employee_id: e.id, amount: 15000 }] }, actorId))!;

        const payout = await PayrollPayoutService.create({ bonus_id: bonus!.id });
        expect(payout!.amount.toString()).toBe("15000");
        expect(payout!.payroll_record_id).toBeNull();
        expect(payout!.bonus_id).toBe(bonus!.id);
        await expect(PayrollPayoutService.create({ bonus_id: bonus!.id })).rejects.toMatchObject({ status: 409 });

        // The inherited rule: no confirmation without the transfer reference.
        expect(markPaidSchema.safeParse({ from_instrument_id: instrumentId }).success).toBe(false);

        await PayrollPayoutService.markPaid(payout!.id, {
            transaction_ref: "BKA-BONUS",
            from_instrument_id: instrumentId,
            paid_by_id: actorId,
        });
        const expenses = await prisma.expense.findMany({ where: { remarks: { contains: payout!.id } } });
        expect(expenses.map((x) => x.category).sort()).toEqual(["FESTIVAL_BONUS", "SALARY_TRANSFER_FEE"]);
        expect(expenses.find((x) => x.category === "FESTIVAL_BONUS")!.amount.toString()).toBe("15000");
        const payments = await prisma.payment.findMany({ where: { ref_id: payout!.id } });
        expect(payments).toHaveLength(1);
        expect(payments[0]).toMatchObject({ ref_type: "PAYROLL", direction: "OUTGOING" });

        // ...and the bonus expense can't be paid a second time through POST /payments.
        const { PaymentService } = await import("./payment.service");
        const bonusExpense = expenses.find((x) => x.category === "FESTIVAL_BONUS")!;
        await expect(
            PaymentService.create({
                amount: 10,
                payment_date: new Date(),
                ref_type: "EXPENSE",
                ref_id: bonusExpense.id,
                from_instrument_id: instrumentId,
            }),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("the database refuses a payout linked to both a record and a bonus, or to neither", async () => {
        const e = await newEmployee({ name: "Check Constraint", religion: "ISLAM", joined: "2025-01-01" });
        const record = await prisma.payrollRecord.create({
            data: {
                employee_id: e.id,
                month: new Date(Date.UTC(2026, 0, 1)),
                reference_salary: 15000,
                fixed_wage: 13500,
                score_sum: 0,
                adjustment_percent: 0,
                allowance: 1500,
                total_pay: 15000,
            },
        });
        recordIds.push(record.id);
        const event = await newEvent();
        const [bonus] = (await BonusEventService.grant(event.id, { bonuses: [{ employee_id: e.id, amount: 100 }] }, actorId))!;
        const base = { method: "BKASH" as const, account_number: "01700000000", amount: 100 };

        await expect(
            (async () => prisma.employeePayout.create({ data: { ...base } }))(),
        ).rejects.toThrow();
        await expect(
            (async () =>
                prisma.employeePayout.create({
                    data: { ...base, payroll_record_id: record.id, bonus_id: bonus!.id },
                }))(),
        ).rejects.toThrow();
    });

    test("the payout service wants exactly one of payroll_record_id and bonus_id", async () => {
        const { createPayrollPayoutSchema } = await import("@validators/payroll-payout.validator");
        const id = crypto.randomUUID();
        expect(createPayrollPayoutSchema.safeParse({}).success).toBe(false);
        expect(createPayrollPayoutSchema.safeParse({ payroll_record_id: id, bonus_id: id }).success).toBe(false);
        expect(createPayrollPayoutSchema.safeParse({ bonus_id: id }).success).toBe(true);
    });

    test("religion shows on the employee's own record, nowhere else", async () => {
        const e = await newEmployee({ name: "Private Faith", religion: "ISLAM", joined: "2025-01-01" });
        const record = await prisma.payrollRecord.create({
            data: {
                employee_id: e.id,
                month: new Date(Date.UTC(2026, 1, 1)),
                reference_salary: 15000,
                fixed_wage: 13500,
                score_sum: 0,
                adjustment_percent: 0,
                allowance: 1500,
                total_pay: 15000,
            },
        });
        recordIds.push(record.id);

        expect((await EmployeeService.getById(e.id)).religion).toBe("ISLAM");
        expect("religion" in (await PayrollRecordService.getById(record.id)).employee).toBe(false);
        expect("religion" in (await PayrollRecordService.payslip(record.id)).employee).toBe(false);
        const list = await EmployeeService.getAll({ page: 1, limit: 100 } as never);
        expect(list.employees.every((x) => !("religion" in x))).toBe(true);
    });
});
