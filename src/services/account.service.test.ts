import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { AuthService } from "./auth.service";
import { hashPassword } from "@lib/password";
import { purgeAuditLog } from "@lib/test-fixtures";

const PASSWORD = "correct horse battery";
const mobile = () => `+880${Math.floor(1e9 + Math.random() * 8e9)}`;
const ids: string[] = [];

async function admin(name: string) {
    const profile = await prisma.profiles.create({
        data: {
            name,
            mobile: mobile(),
            email: `${crypto.randomUUID()}@account.test`,
            role: "ADMIN",
            password_hash: await hashPassword(PASSWORD),
            admins: { create: {} },
        },
    });
    ids.push(profile.id);
    return profile;
}

describe("Account self-service", () => {
    let me: Awaited<ReturnType<typeof admin>>;
    beforeAll(async () => {
        me = await admin("Account Owner");
    });
    afterAll(async () => {
        await purgeAuditLog({ where: { record_id: { in: ids } } });
        await prisma.admins.deleteMany({ where: { profile_id: { in: ids } } });
        await prisma.profiles.deleteMany({ where: { id: { in: ids } } });
    });

    test("account returns the profile details and when the admin joined", async () => {
        const a = await AuthService.account(me.id);
        expect(a).toMatchObject({ name: "Account Owner", email: me.email, role: "ADMIN", is_active: true });
        expect(a.admin_since).toBeInstanceOf(Date);
    });

    test("updateAccount changes name, mobile and address, and an empty address clears it", async () => {
        const next = mobile();
        const a = await AuthService.updateAccount(me.id, { name: "New Name", mobile: next, address: "Dhaka" });
        expect(a).toMatchObject({ name: "New Name", mobile: next, address: "Dhaka" });
        expect((await AuthService.updateAccount(me.id, { address: "" })).address).toBeNull();
        await expect(AuthService.updateAccount(me.id, {})).rejects.toMatchObject({ status: 400 });
    });

    test("deactivateSelf needs the right password and another active admin", async () => {
        const other = await admin("Other Admin");
        await expect(AuthService.deactivateSelf(other.id, "wrong password")).rejects.toMatchObject({ status: 400 });
        expect((await prisma.profiles.findUnique({ where: { id: other.id } }))?.is_active).toBe(true);

        await AuthService.deactivateSelf(other.id, PASSWORD);
        expect((await prisma.profiles.findUnique({ where: { id: other.id } }))?.is_active).toBe(false);
    });
    // The last-active-admin guard isn't tested here: the table is shared with real admins, and proving it means
    // deactivating them. It is the same rule AdminService.setActive enforces.
});
