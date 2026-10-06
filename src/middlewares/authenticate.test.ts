import { describe, test, expect, afterAll } from "bun:test";
import prisma from "@lib/db";
import { hashPassword } from "@lib/password";
import { app } from "../App";
import { purgeAuditLog } from "@lib/test-fixtures";

// Drives the real app end to end: login -> cookie/bearer -> default-deny -> role guard.

const PASSWORD = "correct-horse-1";
const uniq = () => Math.random().toString(36).slice(2, 10);
const mobile = () => `+880${Math.floor(1e9 + Math.random() * 8e9)}`;
const profileIds: string[] = [];

async function makePerson(role: "ADMIN" | "EMPLOYEE", over: { must_change?: boolean } = {}) {
    const email = `auth-${uniq()}@test.local`;
    const profile = await prisma.profiles.create({
        data: {
            name: "Auth Test",
            mobile: mobile(),
            email,
            role,
            password_hash: await hashPassword(PASSWORD),
            must_change_password: over.must_change ?? false,
        },
    });
    if (role === "ADMIN") await prisma.admins.create({ data: { profile_id: profile.id } });
    profileIds.push(profile.id);
    return { id: profile.id, email };
}

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
    });

const mobileLogin = async (email: string, password = PASSWORD) => {
    const res = await post("/api/auth/login", { email, password, client: "mobile" });
    const body = (await res.json()) as { data?: { token?: string } };
    return { res, token: body.data?.token ?? "" };
};
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("authenticate", () => {
    afterAll(async () => {
        await purgeAuditLog({ where: { changed_by_id: { in: profileIds } } });
        await prisma.admins.deleteMany({ where: { profile_id: { in: profileIds } } });
        await prisma.profiles.deleteMany({ where: { id: { in: profileIds } } });
    });

    test("no session is a 401 on a protected route, and /health stays open", async () => {
        expect((await app.request("/api/houses")).status).toBe(401);
        expect((await app.request("/health")).status).toBe(200);
    });

    test("wrong password and unknown email give the same 401", async () => {
        const { email } = await makePerson("ADMIN");
        const wrong = await post("/api/auth/login", { email, password: "nope-nope-1" });
        const unknown = await post("/api/auth/login", {
            email: `nobody-${uniq()}@test.local`,
            password: PASSWORD,
        });
        expect(wrong.status).toBe(401);
        expect(unknown.status).toBe(401);
        expect(await wrong.json()).toEqual(await unknown.json());
    });

    test("web login sets an httpOnly cookie and keeps the token out of the body", async () => {
        const { email } = await makePerson("ADMIN");
        const res = await post("/api/auth/login", { email, password: PASSWORD });
        expect(res.status).toBe(200);
        const cookie = res.headers.get("set-cookie") ?? "";
        expect(cookie).toContain("fms_session=");
        expect(cookie.toLowerCase()).toContain("httponly");
        expect(JSON.stringify(await res.json())).not.toContain("token");

        const me = await app.request("/api/auth/me", {
            headers: { Cookie: cookie.split(";")[0]! },
        });
        expect(me.status).toBe(200);
    });

    test("mobile login returns a bearer token that works", async () => {
        const { id, email } = await makePerson("EMPLOYEE");
        const { res, token } = await mobileLogin(email.toUpperCase());
        expect(res.status).toBe(200);
        const me = await app.request("/api/auth/me", { headers: bearer(token) });
        expect(((await me.json()) as { data: { id: string } }).data.id).toBe(id);
    });

    test("a forged or garbage token is a 401", async () => {
        const res = await app.request("/api/houses", { headers: bearer("not.a.token") });
        expect(res.status).toBe(401);
    });

    test("an employee is refused admin-only routes; an admin is not", async () => {
        const emp = await makePerson("EMPLOYEE");
        const adm = await makePerson("ADMIN");
        const empToken = (await mobileLogin(emp.email)).token;
        const admToken = (await mobileLogin(adm.email)).token;

        expect((await app.request("/api/admins", { headers: bearer(empToken) })).status).toBe(403);
        expect((await app.request("/api/devices", { headers: bearer(empToken) })).status).toBe(403);
        expect((await app.request("/api/admins", { headers: bearer(admToken) })).status).toBe(200);
    });

    test("an employee with no role in the matrix is refused everything but their own account", async () => {
        const { email } = await makePerson("EMPLOYEE"); // no Employees row -> no role
        const { token } = await mobileLogin(email);
        expect((await app.request("/api/houses", { headers: bearer(token) })).status).toBe(403);
        expect((await app.request("/api/auth/me", { headers: bearer(token) })).status).toBe(200);
    });

    test("an admin creating an admin over HTTP is audit-logged as the logged-in admin", async () => {
        const adm = await makePerson("ADMIN");
        const token = (await mobileLogin(adm.email)).token;
        const res = await post(
            "/api/admins",
            { name: "Made Over HTTP", mobile: mobile(), email: `made-${uniq()}@test.local` },
            bearer(token),
        );
        expect(res.status).toBe(201);
        const created = ((await res.json()) as { data: { id: string; profile_id: string } }).data;
        profileIds.push(created.profile_id);

        const rows = await prisma.auditLog.findMany({
            where: { table_name: "Admins", record_id: created.id },
        });
        expect(rows).toHaveLength(1);
        expect(rows[0]!.changed_by_id).toBe(adm.id);
    });

    test("the upload signature is always for the employees folder, whatever the caller asks", async () => {
        const adm = await makePerson("ADMIN");
        const token = (await mobileLogin(adm.email)).token;
        const res = await app.request("/api/uploads/signature?folder=somewhere-else", {
            headers: bearer(token),
        });
        expect(res.status).toBe(200);
        expect(((await res.json()) as { data: { folder: string } }).data.folder).toBe("employees");
    });

    test("employees can only be (de)activated through terminate and reinstate", async () => {
        const adm = await makePerson("ADMIN");
        const token = (await mobileLogin(adm.email)).token;
        const id = crypto.randomUUID();
        for (const path of [`/api/employees/${id}/deactivate`, `/api/employees/${id}/reactivate`]) {
            // JSON content type: CSRF (on outside dev) treats a bare POST as a form submission.
            const res = await post(path, {}, bearer(token));
            expect(res.status).toBe(404);
        }
    });

    test("a deactivated profile is cut off with its existing token", async () => {
        const { id, email } = await makePerson("ADMIN");
        const { token } = await mobileLogin(email);
        expect((await app.request("/api/auth/me", { headers: bearer(token) })).status).toBe(200);

        await prisma.profiles.update({ where: { id }, data: { is_active: false } });
        expect((await app.request("/api/auth/me", { headers: bearer(token) })).status).toBe(401);
        expect((await mobileLogin(email)).res.status).toBe(401);
    });

    test("temp password: everything is blocked until it is changed, then old tokens die", async () => {
        const { email } = await makePerson("ADMIN", { must_change: true });
        const { token: oldToken } = await mobileLogin(email);

        const blocked = await app.request("/api/houses", { headers: bearer(oldToken) });
        expect(blocked.status).toBe(403);
        expect(
            ((await blocked.json()) as { extensions: { code: string } }).extensions.code,
        ).toBe("PASSWORD_CHANGE_REQUIRED");
        expect((await app.request("/api/auth/me", { headers: bearer(oldToken) })).status).toBe(200);

        const bad = await post(
            "/api/auth/change-password",
            { current_password: "wrong-wrong-1", new_password: "brand-new-pass-1" },
            bearer(oldToken),
        );
        expect(bad.status).toBe(400);
        const short = await post(
            "/api/auth/change-password",
            { current_password: PASSWORD, new_password: "short" },
            bearer(oldToken),
        );
        expect(short.status).toBe(400);

        const changed = await post(
            "/api/auth/change-password",
            { current_password: PASSWORD, new_password: "brand-new-pass-1" },
            bearer(oldToken),
        );
        expect(changed.status).toBe(200);
        const newToken = ((await changed.json()) as { data: { token: string } }).data.token;

        expect((await app.request("/api/houses", { headers: bearer(newToken) })).status).toBe(200);
        expect((await app.request("/api/auth/me", { headers: bearer(oldToken) })).status).toBe(401);
        expect((await mobileLogin(email, "brand-new-pass-1")).res.status).toBe(200);
        expect((await mobileLogin(email)).res.status).toBe(401);
    });

    test("five bad passwords lock the email, even for the right password", async () => {
        const { email } = await makePerson("ADMIN");
        for (let i = 0; i < 5; i++) {
            expect((await post("/api/auth/login", { email, password: "bad-bad-bad-1" })).status).toBe(
                401,
            );
        }
        expect((await post("/api/auth/login", { email, password: PASSWORD })).status).toBe(429);
    });

    test("a profile with no password hash, or a non-staff role, cannot log in", async () => {
        const email = `nopw-${uniq()}@test.local`;
        const p = await prisma.profiles.create({
            data: { name: "No PW", mobile: mobile(), email, role: "ADMIN" },
        });
        profileIds.push(p.id);
        expect((await post("/api/auth/login", { email, password: PASSWORD })).status).toBe(401);

        const cust = `cust-${uniq()}@test.local`;
        const c = await prisma.profiles.create({
            data: {
                name: "Cust",
                mobile: mobile(),
                email: cust,
                role: "CUSTOMER",
                password_hash: await hashPassword(PASSWORD),
            },
        });
        profileIds.push(c.id);
        expect((await post("/api/auth/login", { email: cust, password: PASSWORD })).status).toBe(401);
    });
});
