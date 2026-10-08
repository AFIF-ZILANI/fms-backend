import type { AuthContext } from "../types/app";

/**
 * What a logged-in EMPLOYEE may call. Admins may call everything; anything an
 * employee isn't explicitly allowed here is a 403 (default-deny).
 *
 * Mirrors the mobile permission matrix (mobile/docs/PRD.md §4,
 * mobile/src/lib/permissions.ts) plus the endpoints the app actually calls.
 * "worker" rules apply to WORKER and MANAGER; "manager" rules to MANAGER only.
 * Any other Employees.role code gets nothing until it is given a place here.
 *
 * ponytail: ownership is only enforced for a worker's own employee record and
 * the employee_id filter on payroll/performance reads. A worker can still read
 * anyone's house/batch data (that's the job) and complete any task assignment
 * by id -- scope the latter in TaskAssignmentService if that matters.
 */
type Rule = {
    methods: string[];
    path: RegExp;
    level: "worker" | "manager";
    /** A worker may only touch their own employee: the :id in the path, or the employee_id query. */
    own?: "param" | "query";
};

const GET = ["GET"];
const POST = ["POST"];

const READ_ANY = [
    "houses",
    "batches",
    "batch-house-balances",
    "batch-house-allocations",
    "items",
    "warehouses",
    "tasks",
    "task-types",
    "task-assignments",
    "alerts",
    "stock-units",
    "medications",
    "vaccinations",
    "weight-records",
    "mortality-logs",
    "environment-records",
    "consumptions",
    "batch-feeding-programs",
];

const RULES: Rule[] = [
    { methods: GET, path: new RegExp(`^/(${READ_ANY.join("|")})(/.*)?$`), level: "worker" },
    // Own record for a worker, any record for a manager.
    { methods: GET, path: /^\/employees\/([^/]+)$/, level: "worker", own: "param" },
    { methods: GET, path: /^\/(performance-score-entries|payroll-records)$/, level: "worker", own: "query" },
    { methods: GET, path: /^\/employees$/, level: "manager" },
    // The five log forms, and finishing a task.
    {
        methods: POST,
        path: /^\/(weight-records|mortality-logs|environment-records|consumptions|vaccinations|medications)$/,
        level: "worker",
    },
    { methods: POST, path: /^\/task-assignments\/[^/]+\/complete$/, level: "worker" },
    // Manager actions.
    {
        methods: POST,
        path: /^\/(task-assignments|performance-score-entries|batch-house-allocations|batch-feeding-programs|inventory-adjustments|alerts)$/,
        level: "manager",
    },
    { methods: POST, path: /^\/task-assignments\/[^/]+\/cancel$/, level: "manager" },
    // Clearing an alert by hand: the ones a manager flagged themselves never clear on their own.
    { methods: POST, path: /^\/alerts\/[^/]+\/resolve$/, level: "manager" },
    // Scanning a coded unit into a house is floor work, not a manager action.
    { methods: POST, path: /^\/stock-units\/[^/]+\/relocate$/, level: "worker" },
    { methods: POST, path: /^\/stock-units\/[^/]+\/bind$/, level: "manager" },
];

/** `path` is relative to /api. */
export function canAccess(
    auth: AuthContext,
    method: string,
    path: string,
    query: (name: string) => string | undefined,
): boolean {
    if (auth.role === "ADMIN") return true;
    if (auth.role !== "EMPLOYEE") return false;

    const level =
        auth.employee_role === "MANAGER" ? "manager" : auth.employee_role === "WORKER" ? "worker" : null;
    if (!level) return false;

    const clean = path.length > 1 ? path.replace(/\/+$/, "") : path;
    for (const rule of RULES) {
        const m = rule.path.exec(clean);
        if (!m || !rule.methods.includes(method)) continue;
        if (rule.level === "manager" && level !== "manager") return false;
        if (rule.own && level === "worker") {
            const target = rule.own === "param" ? m[1] : query("employee_id");
            return target !== undefined && target === auth.employee_id;
        }
        return true;
    }
    return false;
}
