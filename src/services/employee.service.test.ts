import { AuthService } from "./auth.service";
import { describe, test, expect, afterAll } from "bun:test";
import prisma from "@lib/db";
import { EmployeeService } from "./employee.service";
import { PayrollRecordService } from "./payroll-record.service";
import { AppError } from "@lib/app-error";
import { createEmployeeSchema } from "@validators/employee.validator";
import type { CreateEmployeeInput } from "@validators/employee.validator";
import { fixedWageFor, referenceSalaryFor } from "@lib/payroll-math";
import { purgeAuditLog } from "@lib/test-fixtures";

const mobile = () => `+880${Math.floor(1e9 + Math.random() * 8e9)}`;
const createdIds: string[] = [];
const avatarIds: string[] = [];
// Captured at creation. Resolving profiles *after* deleting their employees
// matches nothing, which is how this suite leaked a profile per test for
// however long it has been running.
const profileIds: string[] = [];

/** Remembers everything a test created so afterAll can unwind it in FK order. */
function track(employee: { id: string; profile_id: string; profile: { avatar_id: string | null } }) {
    createdIds.push(employee.id);
    profileIds.push(employee.profile_id);
    if (employee.profile.avatar_id) avatarIds.push(employee.profile.avatar_id);
    return employee;
}

/**
 * A complete hire payload -- every field docs/employee_hire.md marks Mandatory.
 * reference_salary is deliberately not defaulted here: it's an optional
 * override, and a test that wants one absent should get an absent one.
 */
const hire = (over: Partial<CreateEmployeeInput> = {}): CreateEmployeeInput => ({
    name: "Test Worker",
    mobile: mobile(),
    email: `worker${Math.floor(Math.random() * 1e9)}@zerodfarms.test`,
    address: "Shed 3, Gazipur",
    date_of_birth: new Date("1995-04-12"),
    marital_status: "SINGLE",
    nid_number: "1990123456789",
    avatar: { public_id: "employees/test", image_url: "https://res.cloudinary.com/x/test.jpg" },
    role: "WORKER",
    education: "HSC",
    experience_years: 2,
    experience: "Layer farm in Gazipur, feeding and cleaning",
    emergency_name: "Karim Mia",
    emergency_relation: "father",
    emergency_phone: "+8801710000000",
    ...over,
});

describe("EmployeeService", () => {
    afterAll(async () => {
        // Children first, or the employee delete trips a foreign key and the
        // whole teardown aborts -- leaving rows behind in the dev database.
        const records = await prisma.payrollRecord.findMany({
            where: { employee_id: { in: createdIds } },
            select: { id: true },
        });
        await prisma.employeePayout.deleteMany({
            where: { payroll_record_id: { in: records.map((r) => r.id) } },
        });
        await prisma.payrollRecord.deleteMany({ where: { employee_id: { in: createdIds } } });
        await prisma.performanceScoreEntry.deleteMany({
            where: { employee_id: { in: createdIds } },
        });
        await prisma.employeePayoutAccount.deleteMany({
            where: { employee_id: { in: createdIds } },
        });
        await prisma.alerts.deleteMany({
            where: { related_id: { in: [...createdIds, ...records.map((r) => r.id)] } },
        });
        await prisma.employees.updateMany({
            where: { reference_employee_id: { in: createdIds } },
            data: { reference_employee_id: null },
        });
        // changed_by_id is a FK to Profiles, so audit rows must go before the
        // employees (and their profiles) they reference.
        await purgeAuditLog({
            where: { table_name: "Employees", record_id: { in: createdIds } },
        });
        await prisma.employees.deleteMany({ where: { id: { in: createdIds } } });
        await prisma.profiles.deleteMany({ where: { id: { in: profileIds } } });
        await prisma.avatars.deleteMany({ where: { id: { in: avatarIds } } });
    });

    test("create then getById round-trips", async () => {
        const employee = await EmployeeService.create(hire({ name: "Test Worker", role: "WORKER", reference_salary: 15000 }));
        track(employee!);

        const found = await EmployeeService.getById(employee!.id);
        expect(found.profile.name).toBe("Test Worker");
        expect(found.profile.role).toBe("EMPLOYEE");
        expect(found.role).toBe("WORKER");
        expect(found.reference_salary!.toNumber()).toBe(15000);
        expect(fixedWageFor(found.reference_salary!).toNumber()).toBe(13500); // 0.9 × R, derived by the service
        expect(found.profile.is_active).toBe(true);
    });

    test("hiring creates a login: the temp password works once, then must be changed", async () => {
        const data = hire({ role: "WORKER" });
        const employee = await EmployeeService.create(data);
        track(employee!);

        const { profile } = await AuthService.login(data.email, employee!.temp_password, "mobile");
        expect(profile.role).toBe("EMPLOYEE");
        expect(profile.employee_role).toBe("WORKER");
        expect(profile.must_change_password).toBe(true);
        expect("password_hash" in (await EmployeeService.getById(employee!.id)).profile).toBe(false);
    });

    test("resetPassword gives a fresh temp password and drops the old one", async () => {
        const data = hire({ role: "WORKER" });
        const employee = await EmployeeService.create(data);
        track(employee!);

        const { temp_password } = await EmployeeService.resetPassword(employee!.id);
        await expect(
            AuthService.login(data.email, employee!.temp_password, "web"),
        ).rejects.toMatchObject({ status: 401 });
        await AuthService.login(data.email, temp_password, "web");
    });

    test("duplicate mobile throws a conflict", async () => {
        const sharedMobile = mobile();
        const first = await EmployeeService.create(hire({ name: "First", role: "WORKER", reference_salary: 10000, mobile: sharedMobile }));
        track(first!);

        await expect(
            EmployeeService.create(hire({ name: "Second", role: "WORKER", reference_salary: 10000, mobile: sharedMobile })),
        ).rejects.toMatchObject({ status: 409 });
    });

    test("getById on unknown id throws not-found", async () => {
        await expect(
            EmployeeService.getById("00000000-0000-0000-0000-000000000000"),
        ).rejects.toBeInstanceOf(AppError);
    });

    test("update with no fields throws bad-request", async () => {
        const employee = await EmployeeService.create(hire({ name: "Updatable", role: "INTERN", reference_salary: 5000 }));
        track(employee!);

        await expect(EmployeeService.update(employee!.id, {})).rejects.toMatchObject({
            status: 400,
        });
    });

    test("update can promote role and change salary/rating", async () => {
        const employee = await EmployeeService.create(hire({ name: "Promotable", role: "WORKER", reference_salary: 12000 }));
        track(employee!);

        const promoted = await EmployeeService.update(employee!.id, {
            role: "MANAGER",
            reference_salary: 25000,
            rating: 4.5,
        });
        expect(promoted!.role).toBe("MANAGER");
        expect(promoted!.reference_salary!.toNumber()).toBe(25000);
        // A changed reference salary must drag the guaranteed wage with it.
        expect(fixedWageFor(promoted!.reference_salary!).toNumber()).toBe(22500);
        expect(promoted!.rating).toBe(4.5);
    });

    test("the roster leaves out the personal file; the single record keeps it", async () => {
        const unique = `Pii${Math.floor(Math.random() * 1e6)}`;
        const employee = await EmployeeService.create(hire({ name: `${unique} Worker` }));
        track(employee!);

        const { employees } = await EmployeeService.getAll({ page: 1, limit: 50, q: unique });
        const row = employees.find((e) => e.id === employee!.id)!;
        for (const secret of ["nid_number", "date_of_birth", "emergency_phone", "emergency_name", "reference_phone"]) {
            expect(secret in row).toBe(false);
        }
        // What the roster and pickers do read is still there.
        expect(row.profile.name).toBe(`${unique} Worker`);
        expect(row.role).toBe("WORKER");
        expect(row.employment_status).toBeDefined();

        const full = await EmployeeService.getById(employee!.id);
        expect(full.nid_number).toBe("1990123456789");
        expect(full.emergency_phone).toBe("+8801710000000");
    });

    test("terminate and reinstate move employment and the login together", async () => {
        const employee = await EmployeeService.create(hire({ name: "Togglable", role: "WORKER", reference_salary: 9000 }));
        track(employee!);

        const gone = await EmployeeService.terminate(employee!.id);
        expect(gone.employment_status).toBe("TERMINATED");
        expect(gone.profile.is_active).toBe(false);

        const back = await EmployeeService.reinstate(employee!.id);
        expect(back.employment_status).toBe("APPOINTED");
        expect(back.profile.is_active).toBe(true);
    });

    test("an employee created without a salary uses their role's standard", async () => {
        const role = await prisma.employeeRole.findUniqueOrThrow({ where: { code: "WORKER" } });
        // No reference_salary key at all -- the override is genuinely absent.
        const employee = await EmployeeService.create(
            hire({ name: "Standard Worker", role: "WORKER" }),
        );
        track(employee!);
        expect(employee!.reference_salary).toBeNull();

        const loaded = await prisma.employees.findUniqueOrThrow({
            where: { id: employee!.id },
            include: { roleRef: { select: { reference_salary: true } } },
        });
        expect(referenceSalaryFor(loaded).toNumber()).toBe(role.reference_salary.toNumber());
    });

    test("changing a salary override writes one audit row carrying both figures", async () => {
        const employee = await EmployeeService.create(
            hire({ name: "Audited Worker", role: "WORKER", reference_salary: 12000 }),
        );
        track(employee!);

        await EmployeeService.update(employee!.id, { reference_salary: 13000 });

        const logs = await prisma.auditLog.findMany({
            where: { table_name: "Employees", record_id: employee!.id, action: "UPDATE" },
        });
        expect(logs).toHaveLength(1);
        const before = logs[0]!.before_data as { reference_salary: string };
        const after = logs[0]!.after_data as { reference_salary: string };
        expect(Number(before.reference_salary)).toBe(12000);
        expect(Number(after.reference_salary)).toBe(13000);
        expect(logs[0]!.changed_by_id).toBeTruthy();
    });

    test("an update that does not touch the salary writes no audit row", async () => {
        const employee = await EmployeeService.create(
            hire({ name: "Unaudited Worker", role: "WORKER", reference_salary: 12000 }),
        );
        track(employee!);

        await EmployeeService.update(employee!.id, { rating: 4.0 });

        const logs = await prisma.auditLog.findMany({
            where: { table_name: "Employees", record_id: employee!.id },
        });
        expect(logs).toHaveLength(0);
    });

    test("clearing an override with an explicit null stores null and audits the clearing", async () => {
        const employee = await EmployeeService.create(
            hire({ name: "Cleared Worker", role: "WORKER", reference_salary: 12000 }),
        );
        track(employee!);

        const cleared = await EmployeeService.update(employee!.id, { reference_salary: null });
        expect(cleared!.reference_salary).toBeNull();

        const logs = await prisma.auditLog.findMany({
            where: { table_name: "Employees", record_id: employee!.id, action: "UPDATE" },
        });
        expect(logs).toHaveLength(1);
        const before = logs[0]!.before_data as { reference_salary: string | null };
        const after = logs[0]!.after_data as { reference_salary: string | null };
        expect(Number(before.reference_salary)).toBe(12000);
        // A real null, not the string "null" -- clearing must be distinguishable
        // from any value that happens to stringify the same way.
        expect(after.reference_salary).toBeNull();
    });

    test("after clearing an override, payroll pays the role's standard", async () => {
        const role = await prisma.employeeRole.findUniqueOrThrow({ where: { code: "WORKER" } });
        const employee = await EmployeeService.create(
            hire({ name: "Reverted Worker", role: "WORKER", reference_salary: 12000 }),
        );
        track(employee!);

        await EmployeeService.update(employee!.id, { reference_salary: null });

        const month = new Date(Date.UTC(2031, 0, 1));
        const record = await PayrollRecordService.generate({ employee_id: employee!.id, month });
        expect(record.reference_salary.toNumber()).toBe(role.reference_salary.toNumber());
    });

    test("zero and a negative reference salary are still rejected", () => {
        expect(createEmployeeSchema.safeParse(hire({ reference_salary: 0 })).success).toBe(false);
        expect(createEmployeeSchema.safeParse(hire({ reference_salary: -1 })).success).toBe(false);
    });

    test("a role code with no row behind it is rejected", async () => {
        await expect(
            EmployeeService.create(hire({ name: "Bad Role", role: "NO_SUCH_ROLE" })),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("updating to a role code with no row behind it is rejected", async () => {
        const employee = await EmployeeService.create(hire({ name: "Bad Role Update" }));
        track(employee!);

        await expect(
            EmployeeService.update(employee!.id, { role: "NO_SUCH_ROLE" }),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("listing filters by role", async () => {
        const employee = await EmployeeService.create(hire({ name: "FilterMe", role: "INTERN", reference_salary: 4000 }));
        track(employee!);

        const { employees } = await EmployeeService.getAll({ page: 1, limit: 100, role: "INTERN" });
        expect(employees.some((e) => e.id === employee!.id)).toBe(true);
        expect(employees.every((e) => e.role === "INTERN")).toBe(true);
    });

    test("create writes the photo as an Avatars row and links it to the profile", async () => {
        const employee = await EmployeeService.create(hire({ name: "Photographed" }));
        track(employee!);

        expect(employee!.profile.avatar_id).not.toBeNull();
        expect(employee!.profile.avatar?.public_id).toBe("employees/test");
    });

    test("the hire profile round-trips", async () => {
        const employee = await EmployeeService.create(hire({ name: "Detailed" }));
        track(employee!);

        const found = await EmployeeService.getById(employee!.id);
        expect(found.marital_status).toBe("SINGLE");
        expect(found.education).toBe("HSC");
        expect(found.experience_years).toBe(2);
        expect(found.emergency_phone).toBe("+8801710000000");
        // Nobody sets this on create, so the default has to hold.
        expect(found.employment_status).toBe("APPOINTED");
    });

    test("validator rejects a hire missing a mandatory field", () => {
        const { emergency_phone, ...incomplete } = hire();
        expect(createEmployeeSchema.safeParse(incomplete).success).toBe(false);
        expect(createEmployeeSchema.safeParse(hire()).success).toBe(true);
    });

    test("a reference can point at another employee", async () => {
        const referrer = await EmployeeService.create(hire({ name: "Referrer" }));
        track(referrer!);

        const referred = await EmployeeService.create(
            hire({ name: "Referred", reference_employee_id: referrer!.id }),
        );
        track(referred!);

        expect(referred!.reference_employee?.profile.name).toBe("Referrer");
    });

    test("validator rejects a reference that is both an employee and an outsider", () => {
        const both = createEmployeeSchema.safeParse(
            hire({
                reference_employee_id: "3c2f1d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
                reference_name: "Outsider",
                reference_phone: "+8801710000001",
            }),
        );
        expect(both.success).toBe(false);
    });

    test("validator rejects an outside reference with no phone", () => {
        expect(createEmployeeSchema.safeParse(hire({ reference_name: "Outsider" })).success).toBe(
            false,
        );
    });

    test("validator rejects a mobile without the +880 prefix", () => {
        expect(createEmployeeSchema.safeParse(hire({ mobile: "01710000000" })).success).toBe(false);
    });

    test("terminate ends the employment and deactivates the profile together", async () => {
        const employee = await EmployeeService.create(hire({ name: "Leaver" }));
        track(employee!);

        const terminated = await EmployeeService.terminate(employee!.id);
        expect(terminated.employment_status).toBe("TERMINATED");
        expect(terminated.profile.is_active).toBe(false);
    });

    test("terminating twice is a bad request", async () => {
        const employee = await EmployeeService.create(hire({ name: "Left Already" }));
        track(employee!);

        await EmployeeService.terminate(employee!.id);
        await expect(EmployeeService.terminate(employee!.id)).rejects.toMatchObject({ status: 400 });
    });

    test("reinstate brings them back as APPOINTED and active", async () => {
        const employee = await EmployeeService.create(hire({ name: "Rehired" }));
        track(employee!);

        await EmployeeService.terminate(employee!.id);
        const back = await EmployeeService.reinstate(employee!.id);
        expect(back.employment_status).toBe("APPOINTED");
        expect(back.profile.is_active).toBe(true);
    });

    test("reinstating someone who was never terminated is a bad request", async () => {
        const employee = await EmployeeService.create(hire({ name: "Still Here" }));
        track(employee!);

        await expect(EmployeeService.reinstate(employee!.id)).rejects.toMatchObject({ status: 400 });
    });

    test("leaving probation clears the probation end date", async () => {
        const employee = await EmployeeService.create(
            hire({
                name: "Probationer",
                employment_status: "PROBATION",
                probation_end_date: new Date("2026-12-01"),
            }),
        );
        track(employee!);
        expect(employee!.probation_end_date).not.toBeNull();

        // The form doesn't send the date when the status isn't PROBATION, so an
        // omitted key must not leave the old deadline behind.
        const confirmed = await EmployeeService.update(employee!.id, {
            employment_status: "CONFIRMED",
        });
        expect(confirmed!.probation_end_date).toBeNull();
    });

    test("terminating clears the probation end date too", async () => {
        const employee = await EmployeeService.create(
            hire({
                name: "Probation Leaver",
                employment_status: "PROBATION",
                probation_end_date: new Date("2026-12-01"),
            }),
        );
        track(employee!);

        const terminated = await EmployeeService.terminate(employee!.id);
        expect(terminated.probation_end_date).toBeNull();
    });

    test("an update that doesn't touch status leaves the probation date alone", async () => {
        const employee = await EmployeeService.create(
            hire({
                name: "Still On Probation",
                employment_status: "PROBATION",
                probation_end_date: new Date("2026-12-01"),
            }),
        );
        track(employee!);

        const renamed = await EmployeeService.update(employee!.id, { name: "Renamed" });
        expect(renamed!.probation_end_date).not.toBeNull();
    });

    test("listing searches by name and by mobile, and pages", async () => {
        const unique = `Zz${Math.floor(Math.random() * 1e6)}`;
        const created: Array<{ id: string; profile: { mobile: string } }> = [];
        for (let i = 0; i < 3; i++) {
            const e = await EmployeeService.create(hire({ name: `${unique} Worker ${i}` }));
            track(e!);
            created.push(e!);
        }

        const byName = await EmployeeService.getAll({ page: 1, limit: 50, q: unique });
        expect(byName.employees).toHaveLength(3);

        // Case-insensitive, so the search box doesn't care how it was typed.
        const lowered = await EmployeeService.getAll({ page: 1, limit: 50, q: unique.toLowerCase() });
        expect(lowered.employees).toHaveLength(3);

        const byMobile = await EmployeeService.getAll({
            page: 1,
            limit: 50,
            q: created[0]!.profile.mobile,
        });
        expect(byMobile.employees.some((e) => e.id === created[0]!.id)).toBe(true);

        // Paging the filtered set, not the whole table.
        const firstPage = await EmployeeService.getAll({ page: 1, limit: 2, q: unique });
        expect(firstPage.employees).toHaveLength(2);
        expect(firstPage.meta.total).toBe(3);
        expect(firstPage.meta.totalPages).toBe(2);

        const secondPage = await EmployeeService.getAll({ page: 2, limit: 2, q: unique });
        expect(secondPage.employees).toHaveLength(1);
    });

    test("search and the active filter narrow together, not one replacing the other", async () => {
        const unique = `Yy${Math.floor(Math.random() * 1e6)}`;
        const active = await EmployeeService.create(hire({ name: `${unique} Active` }));
        const inactive = await EmployeeService.create(hire({ name: `${unique} Gone` }));
        for (const e of [active, inactive]) {
            track(e!);
        }
        // An inactive profile with no employment change is what the filter is about; set it directly
        // (the API only moves the two together, via terminate).
        await prisma.profiles.update({ where: { id: inactive!.profile_id }, data: { is_active: false } });

        const { employees } = await EmployeeService.getAll({
            page: 1,
            limit: 50,
            q: unique,
            is_active: "true",
        });
        expect(employees).toHaveLength(1);
        expect(employees[0]!.id).toBe(active!.id);
    });

    test("the stage moves appointed -> probation -> confirmed", async () => {
        const employee = await EmployeeService.create(hire({ name: "Progressing" }));
        track(employee!);
        expect(employee!.employment_status).toBe("APPOINTED");

        const onProbation = await EmployeeService.update(employee!.id, {
            employment_status: "PROBATION",
            probation_end_date: new Date("2026-12-01"),
        });
        expect(onProbation!.employment_status).toBe("PROBATION");
        expect(onProbation!.probation_end_date).not.toBeNull();

        const confirmed = await EmployeeService.update(employee!.id, {
            employment_status: "CONFIRMED",
        });
        expect(confirmed!.employment_status).toBe("CONFIRMED");
        // Confirming ends probation, so the deadline goes with it.
        expect(confirmed!.probation_end_date).toBeNull();
    });

    test("the stage can't be edited around terminate and reinstate", async () => {
        const employee = await EmployeeService.create(hire({ name: "Edge Case" }));
        track(employee!);

        // Ending employment has to go through terminate, which also deactivates.
        await expect(
            EmployeeService.update(employee!.id, { employment_status: "TERMINATED" }),
        ).rejects.toMatchObject({ status: 400 });

        await EmployeeService.terminate(employee!.id);
        // And a terminated employee can't be edited back into the workforce.
        await expect(
            EmployeeService.update(employee!.id, { employment_status: "CONFIRMED" }),
        ).rejects.toMatchObject({ status: 400 });

        const back = await EmployeeService.reinstate(employee!.id);
        expect(back.profile.is_active).toBe(true);
    });

    test("kpis project the wage bill using the same formula payroll will", async () => {
        const employee = await EmployeeService.create(
            hire({ name: "KPI Subject", reference_salary: 15000 }),
        );
        track(employee!);

        const before = await EmployeeService.kpis();

        // +3 this month lifts this employee's projection by 3% of R = 450.
        await prisma.performanceScoreEntry.create({
            data: {
                employee_id: employee!.id,
                given_by_id: employee!.profile_id, // any profile; not a create() call
                criterion: "ATTENDANCE_PERFECT",
                points: 3,
                reason: "kpi test",
                incident_date: new Date(),
                idempotency_key: crypto.randomUUID(),
            },
        });

        const after = await EmployeeService.kpis();
        expect(after.wage_bill_projected - before.wage_bill_projected).toBe(450);
    });

    test("kpis count who can't be paid and who has a negative month", async () => {
        const employee = await EmployeeService.create(hire({ name: "KPI Risk" }));
        track(employee!);

        const before = await EmployeeService.kpis();
        // No payout account was created for them, so they're unpayable.
        expect(before.no_payout_account).toBeGreaterThan(0);

        await prisma.performanceScoreEntry.create({
            data: {
                employee_id: employee!.id,
                given_by_id: employee!.profile_id,
                criterion: "UNEXCUSED_ABSENCE",
                points: -2,
                reason: "kpi test",
                incident_date: new Date(),
                idempotency_key: crypto.randomUUID(),
            },
        });

        const after = await EmployeeService.kpis();
        expect(after.negative_performers).toBe(before.negative_performers + 1);
    });

    test("a terminated employee drops out of the KPIs entirely", async () => {
        const employee = await EmployeeService.create(hire({ name: "KPI Leaver" }));
        track(employee!);

        const before = await EmployeeService.kpis();
        await EmployeeService.terminate(employee!.id);
        const after = await EmployeeService.kpis();

        expect(after.active_employees).toBe(before.active_employees - 1);
        // Their wage is no longer part of what the farm expects to pay.
        expect(after.wage_bill_projected).toBeLessThan(before.wage_bill_projected);
    });
});
