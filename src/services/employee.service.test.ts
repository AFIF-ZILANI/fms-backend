import { describe, test, expect, afterAll } from "bun:test";
import prisma from "@lib/db";
import { EmployeeService } from "./employee.service";
import { AppError } from "@lib/app-error";

const mobile = () => `+880${Math.floor(1e9 + Math.random() * 8e9)}`;
const createdIds: string[] = [];

describe("EmployeeService", () => {
    afterAll(async () => {
        await prisma.employees.deleteMany({ where: { id: { in: createdIds } } });
        await prisma.profiles.deleteMany({
            where: { employees: { id: { in: createdIds } } },
        });
    });

    test("create then getById round-trips", async () => {
        const employee = await EmployeeService.create({
            name: "Test Worker",
            mobile: mobile(),
            role: "WORKER",
            salary: 15000,
        });
        createdIds.push(employee!.id);

        const found = await EmployeeService.getById(employee!.id);
        expect(found.profile.name).toBe("Test Worker");
        expect(found.profile.role).toBe("EMPLOYEE");
        expect(found.role).toBe("WORKER");
        expect(found.salary.toNumber()).toBe(15000);
        expect(found.profile.is_active).toBe(true);
    });

    test("duplicate mobile throws a conflict", async () => {
        const sharedMobile = mobile();
        const first = await EmployeeService.create({
            name: "First",
            mobile: sharedMobile,
            role: "WORKER",
            salary: 10000,
        });
        createdIds.push(first!.id);

        await expect(
            EmployeeService.create({
                name: "Second",
                mobile: sharedMobile,
                role: "WORKER",
                salary: 10000,
            }),
        ).rejects.toMatchObject({ status: 409 });
    });

    test("getById on unknown id throws not-found", async () => {
        await expect(
            EmployeeService.getById("00000000-0000-0000-0000-000000000000"),
        ).rejects.toBeInstanceOf(AppError);
    });

    test("update with no fields throws bad-request", async () => {
        const employee = await EmployeeService.create({
            name: "Updatable",
            mobile: mobile(),
            role: "INTERN",
            salary: 5000,
        });
        createdIds.push(employee!.id);

        await expect(EmployeeService.update(employee!.id, {})).rejects.toMatchObject({
            status: 400,
        });
    });

    test("update can promote role and change salary/rating", async () => {
        const employee = await EmployeeService.create({
            name: "Promotable",
            mobile: mobile(),
            role: "WORKER",
            salary: 12000,
        });
        createdIds.push(employee!.id);

        const promoted = await EmployeeService.update(employee!.id, {
            role: "MANAGER",
            salary: 25000,
            rating: 4.5,
        });
        expect(promoted!.role).toBe("MANAGER");
        expect(promoted!.salary.toNumber()).toBe(25000);
        expect(promoted!.rating).toBe(4.5);
    });

    test("setActive(false) then setActive(true) round-trips is_active", async () => {
        const employee = await EmployeeService.create({
            name: "Togglable",
            mobile: mobile(),
            role: "WORKER",
            salary: 9000,
        });
        createdIds.push(employee!.id);

        const deactivated = await EmployeeService.setActive(employee!.id, false);
        expect(deactivated.profile.is_active).toBe(false);

        const reactivated = await EmployeeService.setActive(employee!.id, true);
        expect(reactivated.profile.is_active).toBe(true);
    });

    test("listing filters by role", async () => {
        const employee = await EmployeeService.create({
            name: "FilterMe",
            mobile: mobile(),
            role: "INTERN",
            salary: 4000,
        });
        createdIds.push(employee!.id);

        const { employees } = await EmployeeService.getAll({ page: 1, limit: 100, role: "INTERN" });
        expect(employees.some((e) => e.id === employee!.id)).toBe(true);
        expect(employees.every((e) => e.role === "INTERN")).toBe(true);
    });
});
