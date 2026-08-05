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
            data: { profile_id: profile.id, role: "WORKER", salary: 15000 },
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
        });
        expect(result.success).toBe(false);
    });
});
