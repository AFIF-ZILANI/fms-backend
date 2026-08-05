import { describe, test, expect, afterAll } from "bun:test";
import prisma from "@lib/db";
import { CustomerService } from "./customer.service";
import { AppError } from "@lib/app-error";

const mobile = () => `+880${Math.floor(1e9 + Math.random() * 8e9)}`;
const createdIds: string[] = [];

describe("CustomerService", () => {
    afterAll(async () => {
        await prisma.customers.deleteMany({ where: { id: { in: createdIds } } });
        await prisma.profiles.deleteMany({
            where: { customers: { id: { in: createdIds } } },
        });
    });

    test("create then getById round-trips", async () => {
        const customer = await CustomerService.create({
            name: "Local Market",
            mobile: mobile(),
            company: "Local Market Ltd",
        });
        createdIds.push(customer!.id);

        const found = await CustomerService.getById(customer!.id);
        expect(found.profile.name).toBe("Local Market");
        expect(found.profile.role).toBe("CUSTOMER");
        expect(found.company).toBe("Local Market Ltd");
        expect(found.is_active).toBe(true);
    });

    test("duplicate mobile throws a conflict", async () => {
        const sharedMobile = mobile();
        const first = await CustomerService.create({ name: "First", mobile: sharedMobile });
        createdIds.push(first!.id);

        await expect(
            CustomerService.create({ name: "Second", mobile: sharedMobile }),
        ).rejects.toMatchObject({ status: 409 });
    });

    test("getById on unknown id throws not-found", async () => {
        await expect(
            CustomerService.getById("00000000-0000-0000-0000-000000000000"),
        ).rejects.toBeInstanceOf(AppError);
    });

    test("update with no fields throws bad-request", async () => {
        const customer = await CustomerService.create({ name: "Updatable", mobile: mobile() });
        createdIds.push(customer!.id);

        await expect(CustomerService.update(customer!.id, {})).rejects.toMatchObject({
            status: 400,
        });
    });

    test("update can set rating", async () => {
        const customer = await CustomerService.create({ name: "Ratable", mobile: mobile() });
        createdIds.push(customer!.id);

        const updated = await CustomerService.update(customer!.id, { rating: 4 });
        expect(updated!.rating).toBe(4);
    });

    test("setActive toggles Customers.is_active, not Profiles.is_active", async () => {
        const customer = await CustomerService.create({ name: "Togglable", mobile: mobile() });
        createdIds.push(customer!.id);

        const deactivated = await CustomerService.setActive(customer!.id, false);
        expect(deactivated.is_active).toBe(false);
        expect(deactivated.profile.is_active).toBe(true);

        const reactivated = await CustomerService.setActive(customer!.id, true);
        expect(reactivated.is_active).toBe(true);
    });
});
