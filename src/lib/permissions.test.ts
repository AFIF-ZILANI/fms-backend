import { describe, test, expect } from "bun:test";
import { canAccess } from "./permissions";
import type { AuthContext } from "../types/app";

const none = () => undefined;
const admin: AuthContext = { profile_id: "a", role: "ADMIN", employee_role: null, employee_id: null };
const worker: AuthContext = { profile_id: "w", role: "EMPLOYEE", employee_role: "WORKER", employee_id: "emp-w" };
const manager: AuthContext = { profile_id: "m", role: "EMPLOYEE", employee_role: "MANAGER", employee_id: "emp-m" };
const other: AuthContext = { profile_id: "o", role: "EMPLOYEE", employee_role: "ACCOUNTANT", employee_id: "emp-o" };

describe("canAccess", () => {
    test("admins reach everything", () => {
        for (const [m, p] of [["GET", "/admins"], ["POST", "/payroll-payouts"], ["DELETE", "/houses/1"]] as const) {
            expect(canAccess(admin, m, p, none)).toBe(true);
        }
    });

    test("workers and managers can log work and read the farm", () => {
        for (const who of [worker, manager]) {
            expect(canAccess(who, "GET", "/houses", none)).toBe(true);
            expect(canAccess(who, "GET", "/items/stock-by-location", none)).toBe(true);
            expect(canAccess(who, "POST", "/weight-records", none)).toBe(true);
            expect(canAccess(who, "POST", "/medications", none)).toBe(true);
            expect(canAccess(who, "POST", "/task-assignments/abc/complete", none)).toBe(true);
        }
    });

    test("manager-only actions are refused to a worker", () => {
        for (const [m, p] of [
            ["POST", "/task-assignments"],
            ["POST", "/task-assignments/abc/cancel"],
            ["POST", "/performance-score-entries"],
            ["POST", "/batch-house-allocations"],
            ["POST", "/batch-feeding-programs"],
            ["POST", "/inventory-adjustments"],
            ["POST", "/alerts"],
            ["POST", "/stock-units/abc/bind"],
            ["GET", "/employees"],
        ] as const) {
            expect(canAccess(worker, m, p, none)).toBe(false);
            expect(canAccess(manager, m, p, none)).toBe(true);
        }
    });

    test("workers and managers may move a coded unit; other employee roles may not", () => {
        for (const who of [worker, manager]) {
            expect(canAccess(who, "POST", "/stock-units/abc/relocate", none)).toBe(true);
        }
        expect(canAccess(other, "POST", "/stock-units/abc/relocate", none)).toBe(false);
        // binding stays manager-only
        expect(canAccess(worker, "POST", "/stock-units/abc/bind", none)).toBe(false);
    });

    test("a worker sees only their own employee record, a manager anyone's", () => {
        expect(canAccess(worker, "GET", "/employees/emp-w", none)).toBe(true);
        expect(canAccess(worker, "GET", "/employees/emp-m", none)).toBe(false);
        expect(canAccess(manager, "GET", "/employees/emp-w", none)).toBe(true);
    });

    test("payroll and performance reads need employee_id = self for a worker", () => {
        const q = (id?: string) => (n: string) => (n === "employee_id" ? id : undefined);
        expect(canAccess(worker, "GET", "/payroll-records", q("emp-w"))).toBe(true);
        expect(canAccess(worker, "GET", "/payroll-records", q("emp-m"))).toBe(false);
        expect(canAccess(worker, "GET", "/payroll-records", q())).toBe(false); // no filter = everyone's
        expect(canAccess(worker, "GET", "/performance-score-entries", q("emp-m"))).toBe(false);
        expect(canAccess(manager, "GET", "/payroll-records", q())).toBe(true);
    });

    test("anything not listed is denied -- money, payroll writes, master data, admin surfaces", () => {
        for (const who of [worker, manager]) {
            for (const [m, p] of [
                ["GET", "/admins"],
                ["GET", "/devices"],
                ["GET", "/payments"],
                ["POST", "/payments"],
                ["POST", "/payroll-payouts"],
                ["POST", "/employees"],
                ["POST", "/employees/x/reset-password"],
                ["DELETE", "/houses/1"],
                ["PATCH", "/weight-records/1"],
                ["POST", "/alerts/scan"],
                ["GET", "/audit-logs"],
                ["GET", "/bonus-events"],
                ["POST", "/bonus-events/x/bonuses"],
                ["GET", "/bonus-events/x/proposal"],
                ["GET", "/ingest/v1/sales"],
            ] as const) {
                expect(canAccess(who, m, p, none)).toBe(false);
            }
        }
    });

    test("an employee role with no place in the matrix gets nothing", () => {
        expect(canAccess(other, "GET", "/houses", none)).toBe(false);
    });

    test("a trailing slash does not change the answer", () => {
        expect(canAccess(worker, "GET", "/houses/", none)).toBe(true);
        expect(canAccess(worker, "GET", "/employees/", none)).toBe(false);
    });
});
