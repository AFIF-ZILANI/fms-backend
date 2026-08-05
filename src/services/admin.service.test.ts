import { describe, test, expect, afterAll } from "bun:test";
import prisma from "@lib/db";
import { AdminService } from "./admin.service";
import { AppError } from "@lib/app-error";

const mobile = () => `+880${Math.floor(1e9 + Math.random() * 8e9)}`;
const createdIds: string[] = [];

describe("AdminService", () => {
    afterAll(async () => {
        await prisma.admins.deleteMany({ where: { id: { in: createdIds } } });
        await prisma.profiles.deleteMany({
            where: { admins: { id: { in: createdIds } } },
        });
    });

    test("create then getById round-trips", async () => {
        const admin = await AdminService.create({ name: "Test Admin", mobile: mobile() });
        createdIds.push(admin!.id);

        const found = await AdminService.getById(admin!.id);
        expect(found.profile.name).toBe("Test Admin");
        expect(found.profile.role).toBe("ADMIN");
        expect(found.profile.is_active).toBe(true);
    });

    test("duplicate mobile throws a conflict", async () => {
        const sharedMobile = mobile();
        const first = await AdminService.create({ name: "First", mobile: sharedMobile });
        createdIds.push(first!.id);

        await expect(
            AdminService.create({ name: "Second", mobile: sharedMobile }),
        ).rejects.toMatchObject({ status: 409 });
    });

    test("getById on unknown id throws not-found", async () => {
        await expect(
            AdminService.getById("00000000-0000-0000-0000-000000000000"),
        ).rejects.toBeInstanceOf(AppError);
    });

    test("update with no fields throws bad-request", async () => {
        const admin = await AdminService.create({ name: "Updatable", mobile: mobile() });
        createdIds.push(admin!.id);

        await expect(AdminService.update(admin!.id, {})).rejects.toMatchObject({ status: 400 });
    });

    test("setActive(false) then setActive(true) round-trips is_active", async () => {
        const admin = await AdminService.create({ name: "Togglable", mobile: mobile() });
        createdIds.push(admin!.id);

        const deactivated = await AdminService.setActive(admin!.id, false);
        expect(deactivated.profile.is_active).toBe(false);

        const reactivated = await AdminService.setActive(admin!.id, true);
        expect(reactivated.profile.is_active).toBe(true);
    });
});
