import { describe, test, expect, afterAll } from "bun:test";
import prisma from "@lib/db";
import { EmployeeService } from "./employee.service";
import { AppError } from "@lib/app-error";
import { createEmployeeSchema } from "@validators/employee.validator";
import type { CreateEmployeeInput } from "@validators/employee.validator";

const mobile = () => `+880${Math.floor(1e9 + Math.random() * 8e9)}`;
const createdIds: string[] = [];
const avatarIds: string[] = [];

/** A complete hire payload -- every field docs/employee_hire.md marks Mandatory. */
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
    salary: 15000,
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
        await prisma.employees.deleteMany({ where: { id: { in: createdIds } } });
        await prisma.profiles.deleteMany({
            where: { employees: { id: { in: createdIds } } },
        });
        await prisma.avatars.deleteMany({ where: { id: { in: avatarIds } } });
    });

    test("create then getById round-trips", async () => {
        const employee = await EmployeeService.create(hire({ name: "Test Worker", role: "WORKER", salary: 15000 }));
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
        const first = await EmployeeService.create(hire({ name: "First", role: "WORKER", salary: 10000, mobile: sharedMobile }));
        createdIds.push(first!.id);

        await expect(
            EmployeeService.create(hire({ name: "Second", role: "WORKER", salary: 10000, mobile: sharedMobile })),
        ).rejects.toMatchObject({ status: 409 });
    });

    test("getById on unknown id throws not-found", async () => {
        await expect(
            EmployeeService.getById("00000000-0000-0000-0000-000000000000"),
        ).rejects.toBeInstanceOf(AppError);
    });

    test("update with no fields throws bad-request", async () => {
        const employee = await EmployeeService.create(hire({ name: "Updatable", role: "INTERN", salary: 5000 }));
        createdIds.push(employee!.id);

        await expect(EmployeeService.update(employee!.id, {})).rejects.toMatchObject({
            status: 400,
        });
    });

    test("update can promote role and change salary/rating", async () => {
        const employee = await EmployeeService.create(hire({ name: "Promotable", role: "WORKER", salary: 12000 }));
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
        const employee = await EmployeeService.create(hire({ name: "Togglable", role: "WORKER", salary: 9000 }));
        createdIds.push(employee!.id);

        const deactivated = await EmployeeService.setActive(employee!.id, false);
        expect(deactivated.profile.is_active).toBe(false);

        const reactivated = await EmployeeService.setActive(employee!.id, true);
        expect(reactivated.profile.is_active).toBe(true);
    });

    test("listing filters by role", async () => {
        const employee = await EmployeeService.create(hire({ name: "FilterMe", role: "INTERN", salary: 4000 }));
        createdIds.push(employee!.id);

        const { employees } = await EmployeeService.getAll({ page: 1, limit: 100, role: "INTERN" });
        expect(employees.some((e) => e.id === employee!.id)).toBe(true);
        expect(employees.every((e) => e.role === "INTERN")).toBe(true);
    });

    test("create writes the photo as an Avatars row and links it to the profile", async () => {
        const employee = await EmployeeService.create(hire({ name: "Photographed" }));
        createdIds.push(employee!.id);
        if (employee!.profile.avatar_id) avatarIds.push(employee!.profile.avatar_id);

        expect(employee!.profile.avatar_id).not.toBeNull();
        expect(employee!.profile.avatar?.public_id).toBe("employees/test");
    });

    test("the hire profile round-trips", async () => {
        const employee = await EmployeeService.create(hire({ name: "Detailed" }));
        createdIds.push(employee!.id);
        if (employee!.profile.avatar_id) avatarIds.push(employee!.profile.avatar_id);

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
        createdIds.push(referrer!.id);
        if (referrer!.profile.avatar_id) avatarIds.push(referrer!.profile.avatar_id);

        const referred = await EmployeeService.create(
            hire({ name: "Referred", reference_employee_id: referrer!.id }),
        );
        createdIds.push(referred!.id);
        if (referred!.profile.avatar_id) avatarIds.push(referred!.profile.avatar_id);

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
});
