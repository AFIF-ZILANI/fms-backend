import { describe, test, expect, afterAll } from "bun:test";
import prisma from "@lib/db";
import { EmployeeRoleService } from "./employee-role.service";

describe("EmployeeRole migration", () => {
    test("the three enum values became rows, each with a salary", async () => {
        const roles = await prisma.employeeRole.findMany({ orderBy: { code: "asc" } });
        expect(roles.map((r) => r.code)).toEqual(["INTERN", "MANAGER", "WORKER"]);
        for (const r of roles) expect(r.reference_salary.toNumber()).toBeGreaterThan(0);
        expect(roles.every((r) => r.is_active)).toBe(true);
    });

    test("every existing employee kept their salary as an override", async () => {
        const employees = await prisma.employees.findMany({
            select: { role: true, reference_salary: true },
        });
        // Five rows existed before this migration, all with a salary. None may
        // have been nulled: that would silently hand them the role standard.
        expect(employees.length).toBeGreaterThanOrEqual(5);
        for (const e of employees) {
            expect(e.reference_salary).not.toBeNull();
            expect(typeof e.role).toBe("string");
        }
    });

    test("every employee's role points at a real role row", async () => {
        const [employees, roles] = await Promise.all([
            prisma.employees.findMany({ select: { role: true } }),
            prisma.employeeRole.findMany({ select: { code: true } }),
        ]);
        const codes = new Set(roles.map((r) => r.code));
        for (const e of employees) expect(codes.has(e.role)).toBe(true);
    });
});

describe("EmployeeRoleService", () => {
    const created: string[] = [];

    afterAll(async () => {
        await prisma.employeeRole.deleteMany({ where: { id: { in: created } } });
    });

    test("create derives the code from the label", async () => {
        const role = await EmployeeRoleService.create({
            label: "Shed Worker",
            reference_salary: 14000,
        });
        created.push(role.id);
        expect(role.code).toBe("SHED_WORKER");
        expect(role.reference_salary.toNumber()).toBe(14000);
        expect(role.is_active).toBe(true);
    });

    test("a rename keeps the code, because Employees.role routes on it", async () => {
        const role = await EmployeeRoleService.create({
            label: "Night Guard",
            reference_salary: 11000,
        });
        created.push(role.id);
        const renamed = await EmployeeRoleService.update(role.id, {
            label: "Security Guard",
            reference_salary: 11500,
        });
        expect(renamed.label).toBe("Security Guard");
        expect(renamed.code).toBe("NIGHT_GUARD"); // unchanged
        expect(renamed.reference_salary.toNumber()).toBe(11500);
    });

    test("a label with no letters or digits is rejected", async () => {
        await expect(
            EmployeeRoleService.create({ label: "!!!", reference_salary: 1000 }),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("a role with employees on it cannot be deleted, only deactivated", async () => {
        const worker = await prisma.employeeRole.findUniqueOrThrow({
            where: { code: "WORKER" },
        });
        await expect(EmployeeRoleService.remove(worker.id)).rejects.toMatchObject({
            status: 409,
        });
        const off = await EmployeeRoleService.setActive(worker.id, false);
        expect(off.is_active).toBe(false);
        await EmployeeRoleService.setActive(worker.id, true); // restore
    });

    test("an unused role can be deleted", async () => {
        const role = await EmployeeRoleService.create({
            label: "Temp Helper",
            reference_salary: 6000,
        });
        await EmployeeRoleService.remove(role.id);
        expect(await prisma.employeeRole.findUnique({ where: { id: role.id } })).toBeNull();
    });

    test("the list reports how many employees each role affects", async () => {
        const { rows } = await EmployeeRoleService.getAll({ page: 1, limit: 50 });
        const worker = rows.find((r) => r.code === "WORKER");
        expect(worker!.employee_count).toBeGreaterThanOrEqual(4);
        const intern = rows.find((r) => r.code === "INTERN");
        const internEmployees = await prisma.employees.count({ where: { role: "INTERN" } });
        expect(intern!.employee_count).toBe(internEmployees);
    });
});
