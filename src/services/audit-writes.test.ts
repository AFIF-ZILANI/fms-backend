import { describe, test, expect, afterAll, beforeAll } from "bun:test";
import prisma from "@lib/db";
import { AdminService } from "./admin.service";
import { AuthService } from "./auth.service";
import { EmployeeService } from "./employee.service";
import { EmployeePayoutAccountService } from "./employee-payout-account.service";
import { PerformanceScoreEntryService } from "./performance-score-entry.service";
import { DeviceService } from "./device.service";
import type { CreateEmployeeInput } from "@validators/employee.validator";

// The sensitive actions leave a permanent "who did it" row -- and never a secret.

const uniq = () => Math.random().toString(36).slice(2, 10);
const mobile = () => `+880${Math.floor(1e9 + Math.random() * 8e9)}`;
let actorId: string;
const profileIds: string[] = [];
const adminIds: string[] = [];
const employeeIds: string[] = [];
const avatarIds: string[] = [];
const accountIds: string[] = [];

const rowsFor = (table: string, record_id: string) =>
    prisma.auditLog.findMany({ where: { table_name: table, record_id }, orderBy: { occurred_at: "asc" } });

async function hire() {
    const input: CreateEmployeeInput = {
        name: "Audit Worker",
        mobile: mobile(),
        email: `audit-${uniq()}@test.local`,
        address: "Shed 3, Gazipur",
        date_of_birth: new Date("1995-04-12"),
        marital_status: "SINGLE",
        nid_number: "1990123456789",
        avatar: { public_id: "employees/test", image_url: "https://res.cloudinary.com/x/test.jpg" },
        role: "WORKER",
        education: "HSC",
        experience_years: 2,
        experience: "Layer farm",
        emergency_name: "Karim Mia",
        emergency_relation: "father",
        emergency_phone: "+8801710000000",
    };
    const e = await EmployeeService.create(input, actorId);
    employeeIds.push(e!.id);
    profileIds.push(e!.profile_id);
    if (e!.profile.avatar_id) avatarIds.push(e!.profile.avatar_id);
    return e!;
}

describe("audit writes", () => {
    beforeAll(async () => {
        const actor = await prisma.profiles.create({
            data: { name: "Audit Actor", mobile: mobile(), role: "ADMIN" },
        });
        actorId = actor.id;
        profileIds.push(actor.id);
    });

    afterAll(async () => {
        await prisma.auditLog.deleteMany({ where: { changed_by_id: { in: profileIds } } });
        await prisma.performanceScoreEntry.deleteMany({ where: { employee_id: { in: employeeIds } } });
        await prisma.device.deleteMany({ where: { profile_id: { in: profileIds } } });
        await prisma.pairingCode.deleteMany({ where: { profile_id: { in: profileIds } } });
        await prisma.employeePayoutAccount.deleteMany({ where: { employee_id: { in: employeeIds } } });
        await prisma.employees.deleteMany({ where: { id: { in: employeeIds } } });
        await prisma.admins.deleteMany({ where: { id: { in: adminIds } } });
        await prisma.profiles.deleteMany({ where: { id: { in: profileIds } } });
        await prisma.avatars.deleteMany({ where: { id: { in: avatarIds } } });
    });

    test("creating an admin is recorded against the creator, without the password", async () => {
        const admin = await AdminService.create(
            { name: "New Admin", mobile: mobile(), email: `aud-${uniq()}@test.local` },
            actorId,
        );
        adminIds.push(admin!.id);
        profileIds.push(admin!.profile_id);

        const rows = await rowsFor("Admins", admin!.id);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ action: "CREATE", changed_by_id: actorId });
        expect(JSON.stringify(rows[0])).not.toContain(admin!.temp_password);
    });

    test("deactivating and resetting an admin are recorded; the temp password is not", async () => {
        const a = await AdminService.create(
            { name: "Target", mobile: mobile(), email: `aud-${uniq()}@test.local` },
            actorId,
        );
        adminIds.push(a!.id);
        profileIds.push(a!.profile_id);

        await AdminService.setActive(a!.id, false, actorId);
        const { temp_password } = await AdminService.resetPassword(a!.id, actorId);

        const notes = (await rowsFor("Admins", a!.id)).map((r) => r.note);
        expect(notes).toEqual(["Admin created, login created", "Admin deactivated", "Password reset"]);
        expect(JSON.stringify(await rowsFor("Admins", a!.id))).not.toContain(temp_password);
    });

    test("hiring, resetting, terminating and reinstating an employee are recorded", async () => {
        const e = await hire();
        const reset = await EmployeeService.resetPassword(e.id, actorId);
        await EmployeeService.terminate(e.id, actorId);
        await EmployeeService.reinstate(e.id, actorId);

        const rows = await rowsFor("Employees", e.id);
        expect(rows.map((r) => r.note)).toEqual([
            "Employee hired, login created",
            "Password reset",
            "Employment terminated",
            "Employee reinstated",
        ]);
        expect(rows.every((r) => r.changed_by_id === actorId)).toBe(true);
        const terminated = rows.find((r) => r.note === "Employment terminated")!;
        expect(terminated.after_data).toEqual({ employment_status: "TERMINATED" });
        expect(JSON.stringify(rows)).not.toContain(reset.temp_password);
    });

    test("a person changing their own password is recorded as themselves", async () => {
        const e = await hire();
        await AuthService.login(
            (await prisma.profiles.findUniqueOrThrow({ where: { id: e.profile_id } })).email!,
            e.temp_password,
            "web",
        );
        await AuthService.changePassword(e.profile_id, e.temp_password, "my-own-pass-1", "web");

        const rows = await rowsFor("Profiles", e.profile_id);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ note: "Password changed", changed_by_id: e.profile_id });
        expect(JSON.stringify(rows)).not.toContain("my-own-pass-1");
    });

    test("a payout account records who added it, with only the last four digits", async () => {
        const e = await hire();
        const account = await EmployeePayoutAccountService.create({
            employee_id: e.id,
            method: "BKASH",
            account_name: "Audit Worker",
            account_number: "01712345678",
            verified_by_id: actorId,
        });
        accountIds.push(account!.id);
        await EmployeePayoutAccountService.close(account!.id, actorId);

        const rows = await rowsFor("EmployeePayoutAccount", account!.id);
        expect(rows.map((r) => r.note)).toEqual([
            "Payout account added; any previous one closed",
            "Payout account closed",
        ]);
        expect(rows[0]!.after_data).toMatchObject({ method: "BKASH", account_last4: "5678" });
        expect(JSON.stringify(rows)).not.toContain("01712345678");
    });

    test("terminating records who did it, and reinstating clears it", async () => {
        const e = await hire();
        await EmployeeService.terminate(e.id, actorId);
        expect((await prisma.employees.findUniqueOrThrow({ where: { id: e.id } })).terminated_by_id).toBe(actorId);
        await EmployeeService.reinstate(e.id, actorId);
        expect((await prisma.employees.findUniqueOrThrow({ where: { id: e.id } })).terminated_by_id).toBeNull();
    });

    test("closing or superseding a payout account records who closed it", async () => {
        const e = await hire();
        const make = (n: string) =>
            EmployeePayoutAccountService.create({
                employee_id: e.id,
                method: "BKASH",
                account_name: "Audit Worker",
                account_number: n,
                verified_by_id: actorId,
            });
        const first = await make("01711110001");
        const second = await make("01711110002"); // supersedes the first
        const closedFirst = await prisma.employeePayoutAccount.findUniqueOrThrow({ where: { id: first!.id } });
        expect(closedFirst.closed_by_id).toBe(actorId);
        expect((await prisma.employeePayoutAccount.findUniqueOrThrow({ where: { id: second!.id } })).closed_by_id).toBeNull();

        await EmployeePayoutAccountService.close(second!.id, actorId);
        expect((await prisma.employeePayoutAccount.findUniqueOrThrow({ where: { id: second!.id } })).closed_by_id).toBe(actorId);
    });

    test("voiding and acknowledging a score entry record who did each", async () => {
        const e = await hire();
        const entry = await prisma.performanceScoreEntry.create({
            data: {
                employee_id: e.id,
                given_by_id: actorId,
                criterion: "ATTENDANCE_PERFECT",
                points: 3,
                reason: "who did it",
                incident_date: new Date(),
                idempotency_key: crypto.randomUUID(),
            },
        });
        await PerformanceScoreEntryService.acknowledge(entry.id, e.profile_id); // the employee themselves
        await PerformanceScoreEntryService.void(entry.id, { void_reason: "entered in error" }, actorId);
        const after = await prisma.performanceScoreEntry.findUniqueOrThrow({ where: { id: entry.id } });
        expect(after.acknowledged_by_id).toBe(e.profile_id);
        expect(after.voided_by_id).toBe(actorId);
    });

    test("revoking a device records who revoked it", async () => {
        const { code } = await DeviceService.createPairingCode(actorId);
        const paired = await DeviceService.redeemPairingCode(code, "Who revoked", "android");
        await DeviceService.revoke(paired.device_id, actorId);
        expect((await prisma.device.findUniqueOrThrow({ where: { id: paired.device_id } })).revoked_by_id).toBe(actorId);
    });
});
