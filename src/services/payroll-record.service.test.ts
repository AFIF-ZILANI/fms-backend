import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { PerformanceScoreEntryService } from "./performance-score-entry.service";
import { PayrollRecordService } from "./payroll-record.service";

let profileId: string;
const createdEmployeeIds: string[] = [];
const createdProfileIds: string[] = [];

async function newEmployee(salary: number) {
    const profile = await prisma.profiles.create({
        data: {
            name: "Payroll Test",
            mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
            role: "EMPLOYEE",
        },
    });
    createdProfileIds.push(profile.id);
    const employee = await prisma.employees.create({
        data: { profile_id: profile.id, role: "WORKER", salary },
    });
    createdEmployeeIds.push(employee.id);
    return employee;
}

describe("PayrollRecordService", () => {
    beforeAll(async () => {
        const giver = await prisma.profiles.create({
            data: {
                name: "Payroll Giver",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "ADMIN",
            },
        });
        profileId = giver.id;
    });

    afterAll(async () => {
        await prisma.payrollRecord.deleteMany({
            where: { employee_id: { in: createdEmployeeIds } },
        });
        await prisma.performanceScoreEntry.deleteMany({
            where: { employee_id: { in: createdEmployeeIds } },
        });
        await prisma.employees.deleteMany({ where: { id: { in: createdEmployeeIds } } });
        await prisma.profiles.deleteMany({
            where: { id: { in: [...createdProfileIds, profileId] } },
        });
    });

    // "Great month" from employee-payroll-design.md worked examples,
    // baseline 15000: attendance(+3) + suggestion(+3) + accurate logging(+2)
    // = +8 raw sum, +8% adjustment, final 16200.
    test("great month: +8 sum clamps to +8%, final salary 16200 on 15000 baseline", async () => {
        const employee = await newEmployee(15000);
        const month = new Date("2026-03-15T00:00:00Z");

        for (const criterion of [
            "ATTENDANCE_PERFECT",
            "SUGGESTION_IMPLEMENTED",
            "ACCURATE_DATA_ENTRY",
        ] as const) {
            await PerformanceScoreEntryService.create({
                employee_id: employee.id,
                given_by_id: profileId,
                criterion,
                reason: "worked example",
                date: month,
            });
        }

        const record = await PayrollRecordService.generate({ employee_id: employee.id, month });
        expect(record.score_sum).toBe(8);
        expect(record.adjustment_percent.toNumber()).toBe(8);
        expect(record.final_salary.toNumber()).toBe(16200);
    });

    // "Bad month": biosecurity violation(-4) + negligent loss(-5) + equipment
    // damage(-3) = -12 raw, floored at -10%, final 13500.
    test("bad month: -12 sum floors at -10%, final salary 13500 on 15000 baseline", async () => {
        const employee = await newEmployee(15000);
        const month = new Date("2026-04-15T00:00:00Z");

        for (const criterion of [
            "BIOSECURITY_VIOLATION",
            "NEGLIGENT_LOSS",
            "EQUIPMENT_DAMAGE",
        ] as const) {
            await PerformanceScoreEntryService.create({
                employee_id: employee.id,
                given_by_id: profileId,
                criterion,
                reason: "worked example",
                date: month,
            });
        }

        const record = await PayrollRecordService.generate({ employee_id: employee.id, month });
        expect(record.score_sum).toBe(-12);
        expect(record.adjustment_percent.toNumber()).toBe(-10);
        expect(record.final_salary.toNumber()).toBe(13500);
    });

    // "Runaway great month": six positive entries averaging +4 -> +24 raw,
    // ceilinged at +20%, final 18000.
    test("runaway great month: +24 sum ceilings at +20%, final salary 18000 on 15000 baseline", async () => {
        const employee = await newEmployee(15000);
        const month = new Date("2026-05-15T00:00:00Z");

        for (let i = 0; i < 6; i++) {
            await PerformanceScoreEntryService.create({
                employee_id: employee.id,
                given_by_id: profileId,
                criterion: "OTHER",
                points: 4,
                reason: "worked example",
                date: month,
            });
        }

        const record = await PayrollRecordService.generate({ employee_id: employee.id, month });
        expect(record.score_sum).toBe(24);
        expect(record.adjustment_percent.toNumber()).toBe(20);
        expect(record.final_salary.toNumber()).toBe(18000);
    });

    test("regenerating the same employee+month throws a conflict", async () => {
        const employee = await newEmployee(10000);
        const month = new Date("2026-06-15T00:00:00Z");

        await PayrollRecordService.generate({ employee_id: employee.id, month });
        await expect(
            PayrollRecordService.generate({ employee_id: employee.id, month }),
        ).rejects.toMatchObject({ status: 409 });
    });

    test("a month with no score entries generates at 0% adjustment", async () => {
        const employee = await newEmployee(12000);
        const month = new Date("2026-07-15T00:00:00Z");

        const record = await PayrollRecordService.generate({ employee_id: employee.id, month });
        expect(record.score_sum).toBe(0);
        expect(record.adjustment_percent.toNumber()).toBe(0);
        expect(record.final_salary.toNumber()).toBe(12000);
    });
});
