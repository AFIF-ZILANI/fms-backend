import { describe, test, expect, afterAll } from "bun:test";
import prisma from "@lib/db";
import { AdminService } from "./admin.service";
import { AppError } from "@lib/app-error";
import { AuthService } from "./auth.service";

const mobile = () => `+880${Math.floor(1e9 + Math.random() * 8e9)}`;
const email = () => `admin-${Math.random().toString(36).slice(2, 10)}@test.local`;
const createdIds: string[] = [];

describe("AdminService", () => {
    afterAll(async () => {
        // Resolve the profiles BEFORE deleting the rows that point at them --
        // querying through the relation afterwards matches nothing, which is how
        // this leaked a profile per test.
        const profileIds = (
            await prisma.admins.findMany({
                where: { id: { in: createdIds } },
                select: { profile_id: true },
            })
        ).map((r) => r.profile_id);
        await prisma.admins.deleteMany({ where: { id: { in: createdIds } } });
        await prisma.profiles.deleteMany({ where: { id: { in: profileIds } } });
    });

    test("create then getById round-trips", async () => {
        const admin = await AdminService.create({ name: "Test Admin", mobile: mobile(), email: email() });
        createdIds.push(admin!.id);

        const found = await AdminService.getById(admin!.id);
        expect(found.profile.name).toBe("Test Admin");
        expect(found.profile.role).toBe("ADMIN");
        expect(found.profile.is_active).toBe(true);
    });

    test("duplicate mobile throws a conflict", async () => {
        const sharedMobile = mobile();
        const first = await AdminService.create({ name: "First", mobile: sharedMobile, email: email() });
        createdIds.push(first!.id);

        await expect(
            AdminService.create({ name: "Second", mobile: sharedMobile, email: email() }),
        ).rejects.toMatchObject({ status: 409 });
    });

    test("getById on unknown id throws not-found", async () => {
        await expect(
            AdminService.getById("00000000-0000-0000-0000-000000000000"),
        ).rejects.toBeInstanceOf(AppError);
    });

    test("update with no fields throws bad-request", async () => {
        const admin = await AdminService.create({ name: "Updatable", mobile: mobile(), email: email() });
        createdIds.push(admin!.id);

        await expect(AdminService.update(admin!.id, {})).rejects.toMatchObject({ status: 400 });
    });

    test("setActive(false) then setActive(true) round-trips is_active", async () => {
        const admin = await AdminService.create({ name: "Togglable", mobile: mobile(), email: email() });
        createdIds.push(admin!.id);

        const deactivated = await AdminService.setActive(admin!.id, false);
        expect(deactivated.profile.is_active).toBe(false);

        const reactivated = await AdminService.setActive(admin!.id, true);
        expect(reactivated.profile.is_active).toBe(true);
    });

    test("create hands back a temp password that logs in and must be changed", async () => {
        const e = email();
        const admin = await AdminService.create({ name: "Temp", mobile: mobile(), email: e });
        createdIds.push(admin!.id);

        const { profile } = await AuthService.login(e, admin!.temp_password, "mobile");
        expect(profile.must_change_password).toBe(true);
        expect(profile.role).toBe("ADMIN");
    });

    test("the password hash never appears in an admin response", async () => {
        const admin = await AdminService.create({ name: "Hidden", mobile: mobile(), email: email() });
        createdIds.push(admin!.id);
        expect("password_hash" in (await AdminService.getById(admin!.id)).profile).toBe(false);
    });

    test("an admin cannot deactivate themselves", async () => {
        const admin = await AdminService.create({ name: "Self", mobile: mobile(), email: email() });
        createdIds.push(admin!.id);
        await expect(
            AdminService.setActive(admin!.id, false, admin!.profile_id),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("resetPassword issues a new temp password and kills the old one", async () => {
        const e = email();
        const admin = await AdminService.create({ name: "Reset", mobile: mobile(), email: e });
        createdIds.push(admin!.id);

        const { temp_password } = await AdminService.resetPassword(admin!.id);
        expect(temp_password).not.toBe(admin!.temp_password);
        await expect(AuthService.login(e, admin!.temp_password, "web")).rejects.toMatchObject({
            status: 401,
        });
        await AuthService.login(e, temp_password, "web");
    });

    test("resetPassword refuses your own account", async () => {
        const admin = await AdminService.create({ name: "Mine", mobile: mobile(), email: email() });
        createdIds.push(admin!.id);
        await expect(
            AdminService.resetPassword(admin!.id, admin!.profile_id),
        ).rejects.toMatchObject({ status: 400 });
    });
});
