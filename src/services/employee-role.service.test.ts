import { describe, test, expect } from "bun:test";
import prisma from "@lib/db";

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
