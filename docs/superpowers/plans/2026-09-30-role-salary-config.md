# Role-Based Salary Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `EmployeeRoleNames` enum with an admin-editable `EmployeeRole` table carrying a standard `reference_salary`, and make each employee's own salary an optional override of it.

**Architecture:** The role table holds the standard figure; `Employees.reference_salary` becomes nullable and means "exception to the standard". One pure function, `referenceSalaryFor()`, resolves `override ?? role standard` and is used by every caller that needs R. `Employees.fixed_wage` is dropped — it is always `0.9 × R`, and the immutable record of what was paid is `PayrollRecord.fixed_wage`, which is unaffected.

**Tech Stack:** Bun, Hono, Prisma 7.8 + Postgres, Zod, `bun test`. Web: Vite + React, TanStack Query, base-ui Select, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-30-role-salary-config-design.md`

## Global Constraints

- Server runs from `server/`, web from `web/`. They are **separate git repositories**; commit in each independently.
- Branch per change, merge to main when verified. Never commit to main directly.
- Tests are `bun test` (not vitest — `bun:test` imports fail under vitest). Run server tests with `cd server && bun test src/...`.
- `npx tsc --noEmit` in `server/` has **10 pre-existing errors** in `item.service.test.ts` and `organization.service.test.ts` (unit fixtures predating the current `Unit` enum). Those are expected. Any *other* error is yours.
- Tests run against the real Postgres in `server/.env`. Always clean up rows you create in `afterAll`, in FK order.
- Money is `Prisma.Decimal`, never float. Columns are `Decimal(10, 2)`.
- Actor ids come from `getActorId(c)` in the controller, never from a request body.
- Existing `payroll-math.test.ts` must pass **unchanged** at every commit.

## Deliberate deviation from the spec

The spec says `generate()` should throw `AppError.badRequest` when an employee has neither an override nor a role salary. **That error path is impossible and is not implemented.** `Employees.role` is a required FK and `EmployeeRole.reference_salary` is `NOT NULL`, so a fallback always exists. `referenceSalaryFor()` therefore has no failure mode and no `AppError` import. If `reference_salary` on the role is ever made nullable, restore the throw.

---

### Task 1: The `EmployeeRole` table and migration

**Files:**
- Modify: `server/prisma/schema.prisma` (enum at line 27, `Employees` at lines 483-495)
- Create: `server/prisma/migrations/<timestamp>_employee_role_table/migration.sql`
- Test: `server/src/services/employee-role.service.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `prisma.employeeRole` delegate with fields `{ id: string, code: string, label: string, reference_salary: Decimal, is_active: boolean, created_at: Date, updated_at: Date }`. `prisma.employees.role` is now `string`; `prisma.employees.reference_salary` is `Decimal | null`; `prisma.employees.fixed_wage` no longer exists.

- [ ] **Step 1: Write the failing test**

Create `server/src/services/employee-role.service.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && bun test src/services/employee-role.service.test.ts`
Expected: FAIL — `prisma.employeeRole` is undefined (the model does not exist yet).

- [ ] **Step 3: Edit the schema**

In `server/prisma/schema.prisma`, **delete** the enum at line 27:

```prisma
enum EmployeeRoleNames {
  MANAGER
  WORKER
  INTERN
}
```

Add the new model next to the other lookups (near `ExpenseCategoryLookup`):

```prisma
/// Farm employee roles and the standard salary each one carries. A table rather
/// than an enum so the owner can add, rename and re-price roles in Settings
/// without a migration. The salary here is the standard for the role;
/// Employees.reference_salary overrides it per person.
model EmployeeRole {
  id    String @id @default(uuid())
  /// Derived from the label once at create and never regenerated on rename --
  /// Employees.role routes on it, so a rename must not break the reference.
  code  String @unique
  label String
  /// R for anyone in this role who carries no override. Required: a role with no
  /// standard salary cannot be hired into, and making it optional would add an
  /// impossible-to-reach failure path to every payroll run.
  ///
  /// ponytail: one current figure, not an effective-dated history. Back-dating
  /// payroll for an override-less employee after a change would use today's rate;
  /// PayrollRecord snapshots everything once generated, so only ungenerated past
  /// months are exposed. If that bites, this becomes EmployeeRoleSalary with
  /// active_from/active_to, exactly like EmployeePayoutAccount.
  reference_salary Decimal  @db.Decimal(10, 2)
  is_active        Boolean  @default(true)
  created_at       DateTime @default(now())
  updated_at       DateTime @updatedAt

  employees Employees[]
}
```

In `model Employees`, replace the `role` field and the two salary fields:

```prisma
  role     String
  roleRef  EmployeeRole @relation(fields: [role], references: [code], onUpdate: Cascade)
  /// An exception to the role's standard salary. Null means "use the role's" --
  /// resolved by referenceSalaryFor() in lib/payroll-math.ts, never read raw.
  reference_salary Decimal? @db.Decimal(10, 2)
```

Delete the `fixed_wage` line entirely. Keep `@@index([role])`.

- [ ] **Step 4: Write the migration**

Create `server/prisma/migrations/<timestamp>_employee_role_table/migration.sql` — use a timestamp later than the newest existing migration directory:

```sql
-- EmployeeRoleNames was an enum, so adding a role meant a migration and a
-- deploy. It becomes a table carrying each role's standard salary, editable in
-- Settings. See docs/superpowers/specs/2026-09-30-role-salary-config-design.md.

CREATE TABLE "EmployeeRole" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "reference_salary" DECIMAL(10,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmployeeRole_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EmployeeRole_code_key" ON "EmployeeRole"("code");

-- Seeded from the enum's values so every existing Employees.role still resolves.
-- The salaries are STARTING POINTS THE OWNER MUST CONFIRM in Settings: MANAGER is
-- unambiguous at 15,000, but WORKER currently spans 5,000/10,000/12,000/15,000
-- with no mode, so it takes the highest, and no INTERN exists to infer from.
-- A wrong seed cannot move anyone's pay, because every existing employee keeps
-- an override (see below).
INSERT INTO "EmployeeRole" ("id", "code", "label", "reference_salary", "is_active", "created_at", "updated_at")
VALUES
    (gen_random_uuid(), 'MANAGER', 'Manager', 15000, true, NOW(), NOW()),
    (gen_random_uuid(), 'WORKER',  'Worker',  15000, true, NOW(), NOW()),
    (gen_random_uuid(), 'INTERN',  'Intern',   8000, true, NOW(), NOW());

-- The enum values and the seeded codes are identical strings, so the cast is
-- lossless and every row keeps the role it had.
ALTER TABLE "Employees" ALTER COLUMN "role" TYPE TEXT USING ("role"::text);

ALTER TABLE "Employees" ADD CONSTRAINT "Employees_role_fkey"
    FOREIGN KEY ("role") REFERENCES "EmployeeRole"("code")
    ON UPDATE CASCADE ON DELETE RESTRICT;

-- ON DELETE RESTRICT is what makes the delete guard in the service work: Postgres
-- raises, Prisma reports P2003, and the API answers "deactivate it instead".

DROP TYPE "EmployeeRoleNames";

-- Nullable from here on: null means "use the role's standard". Every existing row
-- keeps its current figure, so all of them are overrides and no role standard
-- drives anyone's pay today.
ALTER TABLE "Employees" ALTER COLUMN "reference_salary" DROP NOT NULL;

-- Always 0.9 x reference_salary, and PayrollRecordService.generate() already
-- recomputed it rather than reading this column -- so the "must survive a ratio
-- change" rule its comment claimed has never actually held. The figure that IS
-- immutable is PayrollRecord.fixed_wage, a snapshot in a month-locked row.
ALTER TABLE "Employees" DROP COLUMN "fixed_wage";
```

- [ ] **Step 5: Apply the migration and regenerate the client**

Run: `cd server && npx prisma migrate deploy && npx prisma generate`
Expected: the migration applies; the client regenerates with no error.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd server && bun test src/services/employee-role.service.test.ts`
Expected: 3 pass.

If "every existing employee kept their salary as an override" fails, **stop** — the migration nulled real salaries. Restore from backup before continuing.

- [ ] **Step 7: Confirm the pre-existing tests still compile against the new schema**

Run: `cd server && npx tsc --noEmit 2>&1 | grep -v "item.service.test\|organization.service.test"`
Expected: errors naming `fixed_wage` and `role` in `employee.service.ts`, `employee.validator.ts`, and test fixtures. These are the work of Tasks 2-4 — record them, do not fix them here.

- [ ] **Step 8: Commit**

```bash
cd server
git checkout -b feat/employee-role-table
git add prisma/schema.prisma prisma/migrations src/services/employee-role.service.test.ts
git commit -m "Add EmployeeRole table, replacing the EmployeeRoleNames enum

Roles become rows so the owner can add and re-price them in Settings without a
migration. Employees.reference_salary becomes nullable -- null means 'use the
role standard' -- and every existing row keeps its figure, so all five are
overrides and no seeded standard moves anyone's pay.

Employees.fixed_wage is dropped: it is always 0.9 x reference_salary, and
generate() already recomputed it instead of reading the column. The immutable
record is PayrollRecord.fixed_wage."
```

---

### Task 2: `referenceSalaryFor()` and the two callers that need it

**Files:**
- Modify: `server/src/lib/payroll-math.ts`
- Modify: `server/src/services/payroll-record.service.ts:136-137`
- Modify: `server/src/services/employee.service.ts:82-92` and `:121`
- Test: `server/src/lib/payroll-math.test.ts`

**Interfaces:**
- Consumes: `prisma.employees.reference_salary` (`Decimal | null`) and the `roleRef` relation from Task 1.
- Produces:
  ```ts
  export function referenceSalaryFor(employee: {
      reference_salary: Prisma.Decimal | null;
      roleRef: { reference_salary: Prisma.Decimal };
  }): Prisma.Decimal
  ```
  Tasks 3-5 do not use it; Task 4 does.

- [ ] **Step 1: Write the failing test**

Append to `server/src/lib/payroll-math.test.ts`:

```ts
import { referenceSalaryFor } from "./payroll-math";
import { Prisma } from "../../prisma/generated/prisma/client";

const D = (n: number) => new Prisma.Decimal(n);

describe("referenceSalaryFor", () => {
    test("an employee's own salary wins over the role standard", () => {
        const r = referenceSalaryFor({
            reference_salary: D(12000),
            roleRef: { reference_salary: D(15000) },
        });
        expect(r.toNumber()).toBe(12000);
    });

    test("no override falls back to the role standard", () => {
        const r = referenceSalaryFor({
            reference_salary: null,
            roleRef: { reference_salary: D(15000) },
        });
        expect(r.toNumber()).toBe(15000);
    });

    test("a zero override is honoured, not treated as absent", () => {
        // ?? not ||, so an unpaid intern on 0 does not silently inherit 15,000.
        const r = referenceSalaryFor({
            reference_salary: D(0),
            roleRef: { reference_salary: D(15000) },
        });
        expect(r.toNumber()).toBe(0);
    });

    test("the resolved figure drives computePay exactly as a raw salary did", () => {
        const resolved = referenceSalaryFor({
            reference_salary: null,
            roleRef: { reference_salary: D(15000) },
        });
        const pay = computePay(resolved, 0);
        expect(pay.fixed_wage.toNumber()).toBe(13500);
        expect(pay.allowance.toNumber()).toBe(1500);
        expect(pay.total_pay.toNumber()).toBe(15000);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && bun test src/lib/payroll-math.test.ts`
Expected: FAIL — `referenceSalaryFor` is not exported.

- [ ] **Step 3: Implement it**

Append to `server/src/lib/payroll-math.ts`:

```ts
/**
 * R for one employee: their own salary if they carry one, otherwise their role's
 * standard. Null is the only "absent" -- `??` rather than `||`, so an override of
 * 0 stays 0 instead of silently inheriting the role's figure.
 *
 * No failure mode: Employees.role is a required FK and EmployeeRole.reference_salary
 * is NOT NULL, so the fallback always exists. If that column is ever made
 * nullable, this has to start throwing.
 */
export function referenceSalaryFor(employee: {
    reference_salary: Prisma.Decimal | null;
    roleRef: { reference_salary: Prisma.Decimal };
}): Prisma.Decimal {
    return employee.reference_salary ?? employee.roleRef.reference_salary;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && bun test src/lib/payroll-math.test.ts`
Expected: all pass, including every pre-existing `computePay` test.

- [ ] **Step 5: Wire it into payroll generation**

In `server/src/services/payroll-record.service.ts`, find the `employee` lookup inside `generate()` and add the relation to its `include`/`select` so `roleRef.reference_salary` is loaded. Then replace lines 136-137:

```ts
        const { adjustment_percent, fixed_wage, allowance, total_pay } = computePay(
            employee.reference_salary,
            score_sum,
        );
```

with:

```ts
        // The role's standard unless this employee carries an override.
        const reference_salary = referenceSalaryFor(employee);
        const { adjustment_percent, fixed_wage, allowance, total_pay } = computePay(
            reference_salary,
            score_sum,
        );
```

and change the `prisma.payrollRecord.create` data from `reference_salary: employee.reference_salary` to `reference_salary,`. Add `referenceSalaryFor` to the existing `@lib/payroll-math` import.

- [ ] **Step 6: Wire it into the dashboard wage-bill projection**

In `server/src/services/employee.service.ts`, the `findMany` at lines 82-92 selects `reference_salary` but not the role. Add to its `select`:

```ts
                    reference_salary: true,
                    roleRef: { select: { reference_salary: true } },
```

Then at line 121 replace:

```ts
            wage_bill_projected += computePay(e.reference_salary, score).total_pay.toNumber();
```

with:

```ts
            wage_bill_projected += computePay(referenceSalaryFor(e), score).total_pay.toNumber();
```

Add `referenceSalaryFor` to the `@lib/payroll-math` import on line 6.

- [ ] **Step 7: Prove generation is unchanged for an employee with an override**

Add to `server/src/services/payroll-record.service.test.ts`, inside the existing `describe`:

```ts
    test("an override is what gets paid; the role standard is ignored", async () => {
        const employee = await newEmployee(12000); // override, role standard is 15,000
        const month = new Date("2027-01-15T00:00:00Z");
        const record = await PayrollRecordService.generate({
            employee_id: employee.id,
            month,
        });
        recordIdsToClean.push(record.id);
        expect(record.reference_salary.toNumber()).toBe(12000);
        expect(record.fixed_wage.toNumber()).toBe(10800); // 0.9 x 12,000
        expect(record.total_pay.toNumber()).toBe(12000);
    });

    test("an employee with no override is paid their role's standard", async () => {
        const employee = await newEmployee(12000);
        // Drop the override so the role's figure has to be the one used.
        await prisma.employees.update({
            where: { id: employee.id },
            data: { reference_salary: null },
        });
        const role = await prisma.employeeRole.findUniqueOrThrow({
            where: { code: "WORKER" },
        });
        const month = new Date("2027-02-15T00:00:00Z");
        const record = await PayrollRecordService.generate({
            employee_id: employee.id,
            month,
        });
        recordIdsToClean.push(record.id);
        expect(record.reference_salary.toNumber()).toBe(role.reference_salary.toNumber());
    });
```

Check the existing `newEmployee` helper in that file: if it sets `fixed_wage`, remove that field, and confirm it sets `role: "WORKER"`.

- [ ] **Step 8: Run the payroll suites**

Run: `cd server && bun test src/lib/payroll-math.test.ts src/services/payroll-record.service.test.ts src/services/payroll-payout.service.test.ts`
Expected: all pass, with the two new tests among them.

- [ ] **Step 9: Commit**

```bash
cd server
git add src/lib/payroll-math.ts src/lib/payroll-math.test.ts src/services/payroll-record.service.ts src/services/payroll-record.service.test.ts src/services/employee.service.ts
git commit -m "Resolve R through referenceSalaryFor(), override then role standard

One pure function, two callers: payroll generation and the dashboard's projected
wage bill, which reads the same formula so the figure shown is the one that will
be paid. Uses ?? rather than ||, so an override of 0 is honoured instead of
silently inheriting the role's salary."
```

---

### Task 3: Admin CRUD for roles

**Files:**
- Create: `server/src/validators/employee-role.validator.ts`
- Create: `server/src/services/employee-role.service.ts`
- Create: `server/src/controllers/employee-role.controller.ts`
- Create: `server/src/routes/employee-role.routes.ts`
- Modify: `server/src/routes/index.ts` (import near line 41, `appRoutes.route` near line 101)
- Test: `server/src/services/employee-role.service.test.ts`

**Interfaces:**
- Consumes: `prisma.employeeRole` from Task 1.
- Produces: `EmployeeRoleService` with `getAll(query)`, `create(input)`, `update(id, input)`, `setActive(id, is_active)`, `remove(id)`. `getAll` returns `{ rows, meta }` where each row carries `employee_count: number`. Task 5 consumes `GET /employee-roles`.

**Why not `lookup-factory`:** its `LookupDelegate` type declares `create(data: { code, label })` and `update(data: { code?, label?, is_active? })` — there is no room for `reference_salary`, and every write would drop it silently. Making the factory generic over extra fields for its fifth and only such caller costs more than this file. The two pieces worth reusing are taken directly: `generateCode` and the `P2003` conflict message.

- [ ] **Step 1: Write the failing tests**

Append to `server/src/services/employee-role.service.test.ts`:

```ts
import { EmployeeRoleService } from "./employee-role.service";

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
        expect(intern!.employee_count).toBe(0);
    });
});
```

Add `afterAll` to the `bun:test` import at the top of the file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && bun test src/services/employee-role.service.test.ts`
Expected: FAIL — cannot resolve `./employee-role.service`.

- [ ] **Step 3: Write the validator**

Create `server/src/validators/employee-role.validator.ts`:

```ts
import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

// `code` is never client-supplied -- it is derived from the label, once, at
// create. Same rule as every other lookup in this codebase.
export const createEmployeeRoleSchema = z.object({
    label: z.string().trim().min(1, "Label is required"),
    reference_salary: z.coerce.number().positive("Reference salary must be positive"),
});

export const updateEmployeeRoleSchema = createEmployeeRoleSchema;

export const listEmployeeRolesQuerySchema = paginationQuerySchema.extend({
    active: z.enum(["true", "false"]).optional(),
});

export type CreateEmployeeRoleInput = z.infer<typeof createEmployeeRoleSchema>;
export type UpdateEmployeeRoleInput = z.infer<typeof updateEmployeeRoleSchema>;
export type ListEmployeeRolesQuery = z.infer<typeof listEmployeeRolesQuerySchema>;
```

- [ ] **Step 4: Write the service**

Create `server/src/services/employee-role.service.ts`:

```ts
import prisma from "@lib/db";
import { Prisma } from "../../prisma/generated/prisma/client";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import { generateCode } from "@lib/code-gen";
import type {
    CreateEmployeeRoleInput,
    UpdateEmployeeRoleInput,
    ListEmployeeRolesQuery,
} from "@validators/employee-role.validator";

/**
 * Roles carry a salary, so this cannot use lookup-factory: its LookupDelegate
 * type admits only code/label/is_active and would drop reference_salary on every
 * write. The two pieces worth reusing are taken directly -- generateCode, and the
 * P2003 conflict message.
 */
export const EmployeeRoleService = {
    async getAll(query: ListEmployeeRolesQuery) {
        const where = query.active !== undefined ? { is_active: query.active === "true" } : {};
        const [rows, total] = await Promise.all([
            prisma.employeeRole.findMany({
                where,
                orderBy: { label: "asc" },
                // The count is what lets Settings say what a change affects, and
                // what makes "deactivate instead" a sentence the owner can act on.
                include: { _count: { select: { employees: true } } },
                ...toSkipTake(query),
            }),
            prisma.employeeRole.count({ where }),
        ]);
        return {
            rows: rows.map(({ _count, ...role }) => ({
                ...role,
                employee_count: _count.employees,
            })),
            meta: buildMeta(total, query),
        };
    },

    async getById(id: string) {
        const role = await prisma.employeeRole.findUnique({ where: { id } });
        if (!role) throw AppError.notFound("EmployeeRole");
        return role;
    },

    async create(data: CreateEmployeeRoleInput) {
        const code = generateCode(data.label);
        if (!code) throw AppError.badRequest("Label must contain at least one letter or number");
        try {
            return await prisma.employeeRole.create({
                data: { code, label: data.label, reference_salary: data.reference_salary },
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    /** The label and salary change; `code` never does. Employees.role references
     *  it, and a rename that moved the code would break that reference. */
    async update(id: string, data: UpdateEmployeeRoleInput) {
        await this.getById(id);
        if (!generateCode(data.label)) {
            throw AppError.badRequest("Label must contain at least one letter or number");
        }
        try {
            return await prisma.employeeRole.update({
                where: { id },
                data: { label: data.label, reference_salary: data.reference_salary },
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    async setActive(id: string, is_active: boolean) {
        await this.getById(id);
        return prisma.employeeRole.update({ where: { id }, data: { is_active } });
    },

    /** Hard delete, guarded by the ON DELETE RESTRICT FK from Employees rather
     *  than a pre-check -- the constraint is the source of truth and races nothing. */
    async remove(id: string) {
        await this.getById(id);
        try {
            return await prisma.employeeRole.delete({ where: { id } });
        } catch (err) {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
                throw AppError.conflict(
                    "EmployeeRole is still in use and cannot be deleted. Deactivate it instead.",
                );
            }
            throw err;
        }
    },
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && bun test src/services/employee-role.service.test.ts`
Expected: all pass.

If "a rename keeps the code" fails with the code changed, the `update` is writing `code` — remove it from the `data` object.

- [ ] **Step 6: Write the controller**

Create `server/src/controllers/employee-role.controller.ts`, following `expense-category.routes.ts`'s controller shape:

```ts
import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { EmployeeRoleService } from "@services/employee-role.service";
import type {
    CreateEmployeeRoleInput,
    UpdateEmployeeRoleInput,
    ListEmployeeRolesQuery,
} from "@validators/employee-role.validator";

export const EmployeeRoleController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListEmployeeRolesQuery>(c, "query");
            const { rows, meta } = await EmployeeRoleService.getAll(query);
            return sendList(c, rows, meta);
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<CreateEmployeeRoleInput>(c, "json");
            const role = await EmployeeRoleService.create(body);
            return sendSuccess(c, role, "Role created");
        });
    },

    async update(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<UpdateEmployeeRoleInput>(c, "json");
            const role = await EmployeeRoleService.update(c.req.param("id") ?? "", body);
            return sendSuccess(c, role, "Role updated");
        });
    },

    async deactivate(c: Context) {
        return withHandler(c, async () =>
            sendSuccess(
                c,
                await EmployeeRoleService.setActive(c.req.param("id") ?? "", false),
                "Role deactivated",
            ),
        );
    },

    async reactivate(c: Context) {
        return withHandler(c, async () =>
            sendSuccess(
                c,
                await EmployeeRoleService.setActive(c.req.param("id") ?? "", true),
                "Role reactivated",
            ),
        );
    },

    async remove(c: Context) {
        return withHandler(c, async () =>
            sendSuccess(c, await EmployeeRoleService.remove(c.req.param("id") ?? ""), "Role deleted"),
        );
    },
};
```

Check `sendList`'s exact signature in `server/src/lib/response.ts` and match it — other controllers in this repo are the reference.

- [ ] **Step 7: Write the routes and register them**

Create `server/src/routes/employee-role.routes.ts`:

```ts
import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { EmployeeRoleController } from "@controllers/employee-role.controller";
import {
    createEmployeeRoleSchema,
    updateEmployeeRoleSchema,
    listEmployeeRolesQuerySchema,
} from "@validators/employee-role.validator";

export const employeeRoleRoutes = new Hono();

employeeRoleRoutes.get("/", zValidatorRfc7807("query", listEmployeeRolesQuerySchema), EmployeeRoleController.getAll);
employeeRoleRoutes.post("/", zValidatorRfc7807("json", createEmployeeRoleSchema), EmployeeRoleController.create);
employeeRoleRoutes.patch("/:id", zValidatorRfc7807("json", updateEmployeeRoleSchema), EmployeeRoleController.update);
employeeRoleRoutes.post("/:id/deactivate", EmployeeRoleController.deactivate);
employeeRoleRoutes.post("/:id/reactivate", EmployeeRoleController.reactivate);
employeeRoleRoutes.delete("/:id", EmployeeRoleController.remove);
```

In `server/src/routes/index.ts`, add the import beside the others (~line 41) and the registration beside the others (~line 101):

```ts
import { employeeRoleRoutes } from "@routes/employee-role.routes";
// ...
appRoutes.route("/employee-roles", employeeRoleRoutes);
```

- [ ] **Step 8: Verify over HTTP**

Run: `cd server && (bun index.ts &) ; sleep 4 ; curl -s localhost:5085/api/employee-roles | head -c 400`
Expected: `success: true` and three roles, each with `employee_count`.

Then confirm the delete guard answers correctly — take a `WORKER` role id from that response:

Run: `curl -s -X DELETE localhost:5085/api/employee-roles/<worker-id> | head -c 300`
Expected: HTTP 409, message "still in use and cannot be deleted. Deactivate it instead."

- [ ] **Step 9: Commit**

```bash
cd server
git add src/validators/employee-role.validator.ts src/services/employee-role.service.ts src/services/employee-role.service.test.ts src/controllers/employee-role.controller.ts src/routes/employee-role.routes.ts src/routes/index.ts
git commit -m "Add admin CRUD for employee roles

Not built on lookup-factory: its delegate type admits only code/label/is_active
and would drop reference_salary on every write. generateCode and the P2003
conflict message are reused directly instead.

code is derived from the label once at create and never on rename, because
Employees.role references it. The list carries employee_count so Settings can
say what a change affects, and deleting a role with employees answers 409."
```

---

### Task 4: Employee create/update — override semantics and the audit trail

**Files:**
- Modify: `server/src/validators/employee.validator.ts:4` and `:58-60`
- Modify: `server/src/services/employee.service.ts:183-193` (create) and `:235-247` (update)
- Test: `server/src/services/employee.service.test.ts`

**Interfaces:**
- Consumes: `referenceSalaryFor` (Task 2), `prisma.employeeRole` (Task 1).
- Produces: `POST /employees` accepts `role` as any active role code and `reference_salary` as optional. Task 5 consumes both.

- [ ] **Step 1: Write the failing tests**

Add to `server/src/services/employee.service.test.ts`:

This file already has a `hire({...})` fixture builder and a `track(employee)`
cleanup helper — both are used by every existing create test (see line 76). Use
them; do not invent a second fixture.

```ts
    test("an employee created without a salary uses their role's standard", async () => {
        const role = await prisma.employeeRole.findUniqueOrThrow({ where: { code: "WORKER" } });
        // No reference_salary key at all -- the override is genuinely absent.
        const employee = await EmployeeService.create(
            hire({ name: "Standard Worker", role: "WORKER" }),
        );
        track(employee!);
        expect(employee!.reference_salary).toBeNull();

        const loaded = await prisma.employees.findUniqueOrThrow({
            where: { id: employee!.id },
            include: { roleRef: { select: { reference_salary: true } } },
        });
        expect(referenceSalaryFor(loaded).toNumber()).toBe(role.reference_salary.toNumber());
    });

    test("changing a salary override writes one audit row carrying both figures", async () => {
        const employee = await EmployeeService.create(
            hire({ name: "Audited Worker", role: "WORKER", reference_salary: 12000 }),
        );
        track(employee!);

        await EmployeeService.update(employee!.id, { reference_salary: 13000 });

        const logs = await prisma.auditLog.findMany({
            where: { table_name: "Employees", record_id: employee!.id, action: "UPDATE" },
        });
        expect(logs).toHaveLength(1);
        const before = logs[0]!.before_data as { reference_salary: string };
        const after = logs[0]!.after_data as { reference_salary: string };
        expect(Number(before.reference_salary)).toBe(12000);
        expect(Number(after.reference_salary)).toBe(13000);
        expect(logs[0]!.changed_by_id).toBeTruthy();
    });

    test("an update that does not touch the salary writes no audit row", async () => {
        const employee = await EmployeeService.create(
            hire({ name: "Unaudited Worker", role: "WORKER", reference_salary: 12000 }),
        );
        track(employee!);

        await EmployeeService.update(employee!.id, { rating: 4.0 });

        const logs = await prisma.auditLog.findMany({
            where: { table_name: "Employees", record_id: employee!.id },
        });
        expect(logs).toHaveLength(0);
    });

    test("a role code with no row behind it is rejected", async () => {
        await expect(
            EmployeeService.create(hire({ name: "Bad Role", role: "NO_SUCH_ROLE" })),
        ).rejects.toMatchObject({ status: 400 });
    });
```

Add `referenceSalaryFor` to the imports from `@lib/payroll-math`. In `afterAll`,
delete audit rows **before** the profiles they reference, since `changed_by_id` is
a FK:

```ts
        await prisma.auditLog.deleteMany({
            where: { table_name: "Employees", record_id: { in: employeeIds } },
        });
```

using whatever id array `track()` populates.

**`handlePrismaWriteError` must map the FK violation to a 400** for the last test
to pass. Check what it currently returns for `P2003` on a create: if it is a 500,
add the mapping there rather than special-casing it in the employee service — every
lookup-backed FK benefits.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && bun test src/services/employee.service.test.ts`
Expected: FAIL — `reference_salary` is still required by the validator, and no audit rows are written.

- [ ] **Step 3: Loosen the validator**

In `server/src/validators/employee.validator.ts`, replace line 4:

```ts
const employeeRole = z.enum(["MANAGER", "WORKER", "INTERN"]);
```

with:

```ts
// Any code in EmployeeRole. Validity is enforced by the FK rather than a list
// here -- the whole point of the table is that the owner adds roles without a
// deploy. Same pattern as Expense.category.
const employeeRole = z.string().trim().min(1, "Role is required");
```

and make the salary optional (line ~58-60):

```ts
    // Optional: omit it and the employee is paid their role's standard. A value
    // here is an override, and is audited as an exception.
    reference_salary: z.coerce
        .number()
        .positive("Reference salary must be positive")
        .optional(),
```

- [ ] **Step 4: Drop `fixed_wage` from create and update**

In `server/src/services/employee.service.ts` `create()`, replace:

```ts
                        reference_salary: employee.reference_salary,
                        fixed_wage: fixedWageFor(employee.reference_salary),
```

with:

```ts
                        // Null when omitted: pay them the role's standard.
                        reference_salary: employee.reference_salary ?? null,
```

In `update()`, delete this block entirely:

```ts
                        // Keep the guaranteed wage in step with a changed reference
                        // salary -- they are one decision, not two fields to remember.
                        ...(employee.reference_salary !== undefined && {
                            fixed_wage: fixedWageFor(employee.reference_salary),
                        }),
```

Remove `fixedWageFor` from the `@lib/payroll-math` import on line 6 if nothing else in the file uses it.

- [ ] **Step 5: Write the audit row on a salary change**

`update()` already runs in a transaction. Inside it, before the `tx.employees.update` call, read the current figure and write the log when it moves:

```ts
                // AuditLog's first writer. Redirecting someone's pay is the one
                // employee edit worth a permanent record, and an override is
                // meant to be visible as an exception rather than a silent edit.
                if (employee.reference_salary !== undefined) {
                    const before = await tx.employees.findUnique({
                        where: { id },
                        select: { reference_salary: true },
                    });
                    const beforeValue = before?.reference_salary?.toString() ?? null;
                    const afterValue = String(employee.reference_salary);
                    if (beforeValue !== afterValue) {
                        await tx.auditLog.create({
                            data: {
                                table_name: "Employees",
                                record_id: id,
                                action: "UPDATE",
                                changed_by_id: actorId,
                                before_data: { reference_salary: beforeValue },
                                after_data: { reference_salary: afterValue },
                                note: "Salary override changed",
                            },
                        });
                    }
                }
```

`actorId` must come from the controller via `getActorId(c)`, never the body. Check `employee.controller.ts`'s `update`: if it does not already pass an actor, add `actor_id: await getActorId(c)` there and thread it into the service input type, following how `employee-payout-account.controller.ts` stamps `verified_by_id`.

- [ ] **Step 6: Fix the assertions the dropped column breaks**

`src/services/employee.service.test.ts:84` asserts the column that no longer
exists:

```ts
        expect(found.fixed_wage.toNumber()).toBe(13500); // 0.9 × R, derived by the service
```

Replace it with the derivation, which is what that line was really checking:

```ts
        expect(fixedWageFor(found.reference_salary!).toNumber()).toBe(13500);
```

and import `fixedWageFor` from `@lib/payroll-math` in the test file. Then grep the
whole test tree for other references:

Run: `cd server && grep -rn "fixed_wage" src/ | grep -v payroll-record | grep -v payroll-math`
Expected: no hits outside test files you have just fixed. Anything in `src/services`
or `src/validators` is unfinished work from Steps 3-5.

- [ ] **Step 7: Run the tests**

Run: `cd server && bun test src/services/employee.service.test.ts`
Expected: all pass.

- [ ] **Step 8: Run the whole server suite**

Run: `cd server && bun test src/`
Expected: every test passes. `payroll-math.test.ts`'s original assertions must be untouched and green.

Then: `cd server && npx tsc --noEmit 2>&1 | grep -v "item.service.test\|organization.service.test"`
Expected: **no output.** Any remaining error is a `fixed_wage` or `role` reference still to fix.

- [ ] **Step 9: Commit and merge the server work**

```bash
cd server
git add src/validators/employee.validator.ts src/services/employee.service.ts src/services/employee.service.test.ts src/controllers/employee.controller.ts
git commit -m "Make an employee's salary an optional override of their role's

Omitting reference_salary now stores null and pays the role's standard. The
validator takes any role code, with validity enforced by the FK rather than a
list that needs a deploy to change.

Changing an override writes an AuditLog row with both figures -- that table's
first writer. fixed_wage is gone from create and update along with the column."

git checkout main
git merge --no-ff feat/employee-role-table -m "Merge: role-based salary configuration"
git branch -d feat/employee-role-table
```

---

### Task 5: Settings tab and the employee form

**Files:**
- Create: `web/src/pages/settings/role-salary-card.tsx`
- Modify: `web/src/pages/settings/settings-page.tsx` (tabs at lines 20-27, content below)
- Modify: `web/src/pages/employees/types.ts:90-92` and `:219-220`
- Modify: `web/src/pages/employees/employee-detail-page.tsx:301-306`
- Modify: the employee form's salary and role fields (`web/src/pages/employees/employee-form-page.tsx`)

**Interfaces:**
- Consumes: `GET /employee-roles` (Task 3), returning `{ id, code, label, reference_salary, is_active, employee_count }` per row; `POST`/`PATCH /employee-roles`, `POST /employee-roles/:id/deactivate` and `/reactivate`, `DELETE /employee-roles/:id`.
- Produces: nothing downstream.

**Note:** `web/` has no test runner. Verification is `npx tsc --noEmit`, `npx vite build`, and driving the real UI.

- [ ] **Step 1: Update the types**

In `web/src/pages/employees/types.ts`, change the `Employee` fields at lines 90-92:

```ts
  /** An override of the role's standard. Null means the role's figure applies. */
  reference_salary: string | null;
```

Delete `fixed_wage` from that type — **only** the `Employee` one. The `PayrollRecord` type at lines 219-220 keeps its `fixed_wage`: that is the month's locked snapshot and still exists server-side.

Add, beside the other types:

```ts
export type EmployeeRole = {
  id: string;
  code: string;
  label: string;
  reference_salary: string;
  is_active: boolean;
  employee_count: number;
};
```

- [ ] **Step 2: Fix the detail page**

`employee-detail-page.tsx:301-306` renders `employee.reference_salary` and `employee.fixed_wage`. The second no longer exists. Replace both stat tiles with:

```tsx
        <Stat
          label="Reference salary"
          value={
            employee.reference_salary
              ? `${formatMoney(employee.reference_salary)} (override)`
              : `${formatMoney(role?.reference_salary ?? 0)} (role standard)`
          }
        />
        <Stat
          label="Fixed wage (guaranteed)"
          value={formatMoney(
            0.9 * Number(employee.reference_salary ?? role?.reference_salary ?? 0),
          )}
        />
```

Fetch the roles list with `useGetData<Paginated<EmployeeRole>>("/employee-roles?limit=100", ["employee-roles"])` and resolve `role` by `r.code === employee.role`. Line 157's `p.fixed_wage` is payroll history from `PayrollRecord` — leave it alone.

- [ ] **Step 3: Build the Settings card**

Create `web/src/pages/settings/role-salary-card.tsx`:

```tsx
import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch, useGetData, type Paginated } from "@/lib/api";
import { formatMoney } from "@/lib/utils";
import type { EmployeeRole } from "@/pages/employees/types";

const FIXED_WAGE_RATIO = 0.9;

export function RoleSalaryCard() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useGetData<Paginated<EmployeeRole>>(
    "/employee-roles?limit=100",
    ["employee-roles"]
  );
  const [label, setLabel] = useState("");
  const [salary, setSalary] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      void queryClient.invalidateQueries({ queryKey: ["employee-roles"] });
      setLabel("");
      setSalary("");
      setEditing(null);
    } catch (error) {
      // The API already words the in-use conflict well; don't restate it here.
      toast.error(error instanceof Error ? error.message : "That didn't work");
    } finally {
      setBusy(false);
    }
  };

  const submit = () =>
    run(
      () =>
        apiFetch(editing ? `/employee-roles/${editing}` : "/employee-roles", {
          method: editing ? "PATCH" : "POST",
          body: JSON.stringify({ label, reference_salary: Number(salary) }),
        }),
      editing ? "Role updated" : "Role added"
    );

  const rows = data?.results ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-4" /> Roles &amp; Salaries
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          This is the standard for new hires. An employee with their own salary keeps it — see
          their record.
        </p>

        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-40 flex-1 flex-col gap-1.5">
            <label className="text-xs text-muted-foreground" htmlFor="role-label">
              Role name
            </label>
            <Input
              id="role-label"
              placeholder="Shed Worker"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="flex w-40 flex-col gap-1.5">
            <label className="text-xs text-muted-foreground" htmlFor="role-salary">
              Reference salary
            </label>
            <Input
              id="role-salary"
              inputMode="decimal"
              placeholder="15000"
              value={salary}
              onChange={(e) => setSalary(e.target.value)}
            />
          </div>
          <Button
            type="button"
            disabled={busy || !label.trim() || !Number(salary)}
            onClick={() => void submit()}
          >
            {editing ? "Save" : "Add role"}
          </Button>
          {editing && (
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          )}
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-2">Role</th>
                  <th className="py-2">Code</th>
                  <th className="py-2 text-right">Reference salary</th>
                  <th className="py-2 text-right">Fixed wage</th>
                  <th className="py-2 text-right">Employees</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="py-2">
                      {r.label}
                      {!r.is_active && (
                        <span className="ml-2 text-xs text-muted-foreground">inactive</span>
                      )}
                    </td>
                    <td className="py-2 font-mono text-xs text-muted-foreground">{r.code}</td>
                    <td className="py-2 text-right tabular-nums">
                      {formatMoney(r.reference_salary)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">
                      {formatMoney(Number(r.reference_salary) * FIXED_WAGE_RATIO)}
                    </td>
                    <td className="py-2 text-right tabular-nums">{r.employee_count}</td>
                    <td className="py-2">
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditing(r.id);
                            setLabel(r.label);
                            setSalary(r.reference_salary);
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            void run(
                              () =>
                                apiFetch(
                                  `/employee-roles/${r.id}/${r.is_active ? "deactivate" : "reactivate"}`,
                                  { method: "POST" }
                                ),
                              r.is_active ? "Role deactivated" : "Role reactivated"
                            )
                          }
                        >
                          {r.is_active ? "Deactivate" : "Reactivate"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={r.employee_count > 0}
                          title={r.employee_count > 0 ? "In use — deactivate it instead" : undefined}
                          onClick={() =>
                            void run(
                              () => apiFetch(`/employee-roles/${r.id}`, { method: "DELETE" }),
                              "Role deleted"
                            )
                          }
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

Delete is disabled when `employee_count > 0`, so the 409 is usually avoided — but
the server stays the authority, because that count can be stale. When it does
fire, the toast shows the API's own wording rather than a guess made here.

Verify `useGetData` and `apiFetch` signatures against `web/src/lib/api.ts`, and the
`Button`/`Input`/`Card` prop names against a neighbouring page. This repo's UI
components are its own, not stock shadcn.

- [ ] **Step 4: Add the tab**

In `web/src/pages/settings/settings-page.tsx`, add the trigger after `categories-units`:

```tsx
        <TabsTrigger value="roles">Roles &amp; Salaries</TabsTrigger>
```

and the content:

```tsx
      <TabsContent value="roles">
        <RoleSalaryCard />
      </TabsContent>
```

with the import beside the others.

- [ ] **Step 5: Update the employee form**

In the employee form, `role` becomes a Select populated from `GET /employee-roles?active=true&limit=100`, using `label` for display and `code` as the value — replacing the hardcoded MANAGER/WORKER/INTERN options.

Salary becomes opt-in: a checkbox, *"Override the role's standard salary"*, with the amount input revealed only when it is checked. Unchecked, the form shows `Uses role standard: ৳15,000` (read from the selected role) and omits `reference_salary` from the payload entirely. This makes an exception a deliberate act rather than the default path.

- [ ] **Step 6: Verify**

Run: `cd web && npx tsc --noEmit && npx vite build`
Expected: both clean.

Run: `cd web && npx eslint src/pages/settings/role-salary-card.tsx src/pages/employees/`
Expected: no new errors. `performance-leaderboard-card.tsx` has a **pre-existing** `Date.now` purity error — ignore that one.

Then drive it with the server running:
1. Settings → Roles & Salaries shows three roles, with employee counts 1 / 4+ / 0 and derived fixed wages.
2. Rename `Worker` → `Shed Worker`; the code stays `WORKER`, and no employee's salary changes.
3. Add `General Manager` at 30,000; it appears in the employee form's role select.
4. Delete `Shed Worker` → 409 with the deactivate message. Delete `General Manager` → succeeds.
5. Create an employee with the override unchecked; their detail page reads "(role standard)".
6. Edit that employee to add an override; the detail page reads "(override)", and `GET /audit-logs` shows one row with both figures.

- [ ] **Step 7: Commit and merge the web work**

```bash
cd web
git checkout -b feat/role-salary-settings
git add src/pages/settings/role-salary-card.tsx src/pages/settings/settings-page.tsx src/pages/employees/
git commit -m "Add Roles & Salaries settings and salary override on the employee form

The role select is populated from the API instead of three hardcoded values, and
salary is now an opt-in override with the role's standard shown when it is off --
so paying someone off-standard is a deliberate act.

Employee.fixed_wage is gone from the client type with the column; the detail page
derives the guaranteed wage from the resolved salary. PayrollRecord.fixed_wage
stays, being the month's locked snapshot."

git checkout main
git merge --no-ff feat/role-salary-settings -m "Merge: roles and salaries in Settings"
git branch -d feat/role-salary-settings
```

---

## Verification checklist

- [ ] `cd server && bun test src/` — all pass, `payroll-math.test.ts` assertions unchanged
- [ ] `cd server && npx tsc --noEmit` — only the 10 known `item`/`organization` test-fixture errors
- [ ] `cd web && npx tsc --noEmit && npx vite build` — clean
- [ ] All five original employees still on 5,000 / 10,000 / 12,000 / 15,000 / 15,000
- [ ] A role rename leaves `code` and every employee's pay untouched
- [ ] Deleting a role with employees returns 409 and offers deactivation
- [ ] An employee with no override is paid their role's standard
- [ ] Changing an override writes exactly one `AuditLog` row with both figures

## Follow-up, not in this plan

Implement `docs/superpowers/specs/2026-09-30-festival-bonus-design.md` next; it depends on `referenceSalaryFor()` from Task 2.
