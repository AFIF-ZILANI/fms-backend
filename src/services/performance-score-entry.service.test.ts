import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { PerformanceScoreEntryService } from "./performance-score-entry.service";
import { createScoreEntrySchema } from "@validators/performance-score-entry.validator";

let employeeId: string;
let profileId: string;
const createdIds: string[] = [];

describe("PerformanceScoreEntryService", () => {
    beforeAll(async () => {
        const profile = await prisma.profiles.create({
            data: {
                name: "Scored Worker",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "EMPLOYEE",
            },
        });
        const employee = await prisma.employees.create({
            data: { profile_id: profile.id, role: "WORKER", reference_salary: 15000, fixed_wage: 13500 },
        });
        employeeId = employee.id;
        const giverProfile = await prisma.profiles.create({
            data: {
                name: "Manager Giver",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "ADMIN",
            },
        });
        profileId = giverProfile.id;
    });

    afterAll(async () => {
        await prisma.performanceScoreEntry.deleteMany({ where: { id: { in: createdIds } } });
        const employee = await prisma.employees.findUnique({ where: { id: employeeId } });
        await prisma.employees.delete({ where: { id: employeeId } });
        await prisma.profiles.deleteMany({
            where: { id: { in: [employee!.profile_id, profileId] } },
        });
    });

    test("fixed criterion snapshots the design doc's point value, ignoring client-supplied points", async () => {
        const entry = await PerformanceScoreEntryService.create({
            employee_id: employeeId,
            given_by_id: profileId,
            criterion: "ATTENDANCE_PERFECT",
            points: 999, // should be ignored -- fixed criteria are server-computed
            reason: "No unexcused absence this month",
            incident_date: new Date(),
        });
        createdIds.push(entry!.id);
        expect(entry!.points).toBe(3);
    });

    test("negative fixed criterion snapshots correctly", async () => {
        const entry = await PerformanceScoreEntryService.create({
            employee_id: employeeId,
            given_by_id: profileId,
            criterion: "FALSIFIED_RECORD",
            reason: "Mortality count didn't match physical count",
            incident_date: new Date(),
            notice_doc_url: "https://docs.zerodfarms.test/notice.pdf", // -5 needs written notice first
        });
        createdIds.push(entry!.id);
        expect(entry!.points).toBe(-5);
    });

    test("OTHER uses the client-supplied points within +-5", async () => {
        const entry = await PerformanceScoreEntryService.create({
            employee_id: employeeId,
            given_by_id: profileId,
            criterion: "OTHER",
            points: 4,
            reason: "Went beyond the fixed list -- organized biosecurity training",
            incident_date: new Date(),
        });
        createdIds.push(entry!.id);
        expect(entry!.points).toBe(4);
    });

    test("OTHER with points out of range is rejected by the validator", () => {
        const result = createScoreEntrySchema.safeParse({
            employee_id: employeeId,
            given_by_id: profileId,
            criterion: "OTHER",
            points: 10,
            reason: "Too high",
            incident_date: new Date(),
        });
        expect(result.success).toBe(false);
    });

    test("an employee cannot score themselves", async () => {
        const employee = await prisma.employees.findUnique({ where: { id: employeeId } });
        await expect(
            PerformanceScoreEntryService.create({
                employee_id: employeeId,
                given_by_id: employee!.profile_id, // their own profile
                criterion: "ATTENDANCE_PERFECT",
                reason: "marking my own homework",
                incident_date: new Date(),
            }),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("an entry of -4 or worse is refused without written notice", async () => {
        await expect(
            PerformanceScoreEntryService.create({
                employee_id: employeeId,
                given_by_id: profileId,
                criterion: "BIOSECURITY_VIOLATION", // -4
                reason: "no notice on file",
                incident_date: new Date(),
            }),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("OTHER is capped at ±5 per employee per month", async () => {
        const month = new Date("2026-03-10T00:00:00Z");
        const first = await PerformanceScoreEntryService.create({
            employee_id: employeeId,
            given_by_id: profileId,
            criterion: "OTHER",
            points: 3,
            reason: "first other",
            incident_date: month,
            approved_by_id: profileId,
        });
        createdIds.push(first!.id);

        // 3 + 3 = 6, over the cap.
        await expect(
            PerformanceScoreEntryService.create({
                employee_id: employeeId,
                given_by_id: profileId,
                criterion: "OTHER",
                points: 3,
                reason: "second other",
                incident_date: month,
                approved_by_id: profileId,
            }),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("the validator refuses an OTHER entry with no Owner approval", () => {
        const parsed = createScoreEntrySchema.safeParse({
            employee_id: employeeId,
            criterion: "OTHER",
            points: 3,
            reason: "unapproved",
            incident_date: new Date(),
        });
        expect(parsed.success).toBe(false);
    });

    test("voiding keeps the entry and its reason, and it stops counting", async () => {
        const entry = await PerformanceScoreEntryService.create({
            employee_id: employeeId,
            given_by_id: profileId,
            criterion: "HELPED_COWORKER",
            reason: "wrong person",
            incident_date: new Date("2026-04-10T00:00:00Z"),
        });
        createdIds.push(entry!.id);

        const voided = await PerformanceScoreEntryService.void(entry!.id, {
            void_reason: "Credited to the wrong employee",
        });
        expect(voided.status).toBe("VOIDED");
        expect(voided.void_reason).toBe("Credited to the wrong employee");
        expect(voided.points).toBe(2); // the entry itself is untouched

        const { entries } = await PerformanceScoreEntryService.getAll({
            page: 1,
            limit: 50,
            employee_id: employeeId,
            status: "ACTIVE",
        });
        expect(entries.some((e) => e.id === entry!.id)).toBe(false);
    });

    test("a month whose payroll is generated rejects new entries", async () => {
        const month = new Date("2026-02-15T00:00:00Z");
        const record = await prisma.payrollRecord.create({
            data: {
                employee_id: employeeId,
                month: new Date(Date.UTC(2026, 1, 1)),
                reference_salary: 15000,
                fixed_wage: 13500,
                score_sum: 0,
                adjustment_percent: 0,
                allowance: 1500,
                total_pay: 15000,
            },
        });

        await expect(
            PerformanceScoreEntryService.create({
                employee_id: employeeId,
                given_by_id: profileId,
                criterion: "ATTENDANCE_PERFECT",
                reason: "too late, month is locked",
                incident_date: month,
            }),
        ).rejects.toMatchObject({ status: 400 });

        await prisma.payrollRecord.delete({ where: { id: record.id } });
    });
});
