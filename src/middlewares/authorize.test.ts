import { describe, test, expect, afterAll } from "bun:test";
import prisma from "@lib/db";
import { EmployeeService } from "@services/employee.service";
import type { CreateEmployeeInput } from "@validators/employee.validator";
import { hashPassword } from "@lib/password";
import { app } from "../App";
import { purgeAuditLog } from "@lib/test-fixtures";

// The phone's whole flow against the real app: hired with a temp password ->
// mobile login -> forced change -> own employee record -> the role matrix.

const mobile = () => `+880${Math.floor(1e9 + Math.random() * 8e9)}`;
const uniq = () => Math.random().toString(36).slice(2, 10);
const employeeIds: string[] = [];
const profileIds: string[] = [];
const avatarIds: string[] = [];

async function hire(role: "WORKER" | "MANAGER") {
    const email = `phone-${uniq()}@test.local`;
    const input: CreateEmployeeInput = {
        name: `Phone ${role}`,
        mobile: mobile(),
        email,
        address: "Shed 3, Gazipur",
        date_of_birth: new Date("1995-04-12"),
        marital_status: "SINGLE",
        nid_number: "1990123456789",
        avatar: { public_id: "employees/test", image_url: "https://res.cloudinary.com/x/test.jpg" },
        role,
        education: "HSC",
        experience_years: 2,
        experience: "Layer farm in Gazipur",
        emergency_name: "Karim Mia",
        emergency_relation: "father",
        emergency_phone: "+8801710000000",
    };
    const e = await EmployeeService.create(input);
    employeeIds.push(e!.id);
    profileIds.push(e!.profile_id);
    if (e!.profile.avatar_id) avatarIds.push(e!.profile.avatar_id);
    return { id: e!.id, email, temp: e!.temp_password };
}

const call = (path: string, token: string, init: RequestInit = {}) =>
    app.request(path, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });

async function phoneLogin(email: string, password: string) {
    const res = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, client: "mobile" }),
    });
    return ((await res.json()) as { data: { token: string } }).data.token;
}

async function readyPhone(role: "WORKER" | "MANAGER") {
    const person = await hire(role);
    const tempToken = await phoneLogin(person.email, person.temp);
    const res = await call("/api/auth/change-password", tempToken, {
        method: "POST",
        body: JSON.stringify({ current_password: person.temp, new_password: "my-own-pass-1" }),
    });
    const token = ((await res.json()) as { data: { token: string } }).data.token;
    return { ...person, token };
}

describe("the phone flow and role matrix", () => {
    afterAll(async () => {
        await purgeAuditLog({ where: { changed_by_id: { in: profileIds } } });
        await prisma.employees.deleteMany({ where: { id: { in: employeeIds } } });
        await prisma.admins.deleteMany({ where: { profile_id: { in: profileIds } } });
        await prisma.profiles.deleteMany({ where: { id: { in: profileIds } } });
        await prisma.avatars.deleteMany({ where: { id: { in: avatarIds } } });
    });

    test("/auth/me reports the employee id and role the app needs", async () => {
        const w = await readyPhone("WORKER");
        const me = (await (await call("/api/auth/me", w.token)).json()) as {
            data: { role: string; employee_id: string; employee_role: string; must_change_password: boolean };
        };
        expect(me.data).toMatchObject({
            role: "EMPLOYEE",
            employee_id: w.id,
            employee_role: "WORKER",
            must_change_password: false,
        });
    });

    test("a worker reads their own employee record but not a colleague's", async () => {
        const w = await readyPhone("WORKER");
        const other = await hire("WORKER");
        expect((await call(`/api/employees/${w.id}`, w.token)).status).toBe(200);
        expect((await call(`/api/employees/${other.id}`, w.token)).status).toBe(403);
        expect((await call("/api/employees?limit=5", w.token)).status).toBe(403);
    });

    test("a worker can read the farm and is refused manager actions and admin surfaces", async () => {
        const w = await readyPhone("WORKER");
        expect((await call("/api/houses", w.token)).status).toBe(200);
        expect((await call("/api/task-assignments", w.token, { method: "POST", body: "{}" })).status).toBe(403);
        expect((await call("/api/inventory-adjustments", w.token, { method: "POST", body: "{}" })).status).toBe(403);
        expect((await call("/api/admins", w.token)).status).toBe(403);
        expect((await call("/api/payments", w.token)).status).toBe(403);
    });

    test("a manager reaches the team and manager actions (validation, not 403)", async () => {
        const m = await readyPhone("MANAGER");
        const w = await hire("WORKER");
        expect((await call("/api/employees?limit=5", m.token)).status).toBe(200);
        expect((await call(`/api/employees/${w.id}`, m.token)).status).toBe(200);
        // An empty body passes authorization and fails validation: 400 proves the guard let it through.
        expect((await call("/api/task-assignments", m.token, { method: "POST", body: "{}" })).status).toBe(400);
        expect((await call("/api/admins", m.token)).status).toBe(403);
    });

    test("payroll reads for a worker must be filtered to themselves", async () => {
        const w = await readyPhone("WORKER");
        expect((await call(`/api/payroll-records?employee_id=${w.id}`, w.token)).status).toBe(200);
        expect((await call("/api/payroll-records", w.token)).status).toBe(403);
        expect((await call("/api/payroll-records?employee_id=someone-else", w.token)).status).toBe(403);
    });

    test("terminating an employee cuts their phone off", async () => {
        const w = await readyPhone("WORKER");
        expect((await call("/api/auth/me", w.token)).status).toBe(200);
        await EmployeeService.terminate(w.id);
        expect((await call("/api/auth/me", w.token)).status).toBe(401);
    });

    test("an admin terminating or reinstating over HTTP is recorded as the logged-in admin", async () => {
        const admin = await prisma.profiles.create({
            data: {
                name: "HTTP Admin",
                mobile: mobile(),
                email: `http-admin-${uniq()}@test.local`,
                role: "ADMIN",
                password_hash: await hashPassword("http-admin-pass-1"),
                password_changed_at: new Date(),
            },
        });
        profileIds.push(admin.id);
        await prisma.admins.create({ data: { profile_id: admin.id } });
        const token = await phoneLogin(admin.email!, "http-admin-pass-1");
        const target = await hire("WORKER");

        const post = (path: string) =>
            app.request(path, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: "{}",
            });
        expect((await post(`/api/employees/${target.id}/terminate`)).status).toBe(200);
        expect((await prisma.employees.findUniqueOrThrow({ where: { id: target.id } })).terminated_by_id).toBe(admin.id);

        expect((await post(`/api/employees/${target.id}/reinstate`)).status).toBe(200);
        expect((await prisma.employees.findUniqueOrThrow({ where: { id: target.id } })).terminated_by_id).toBeNull();
    });
});
