import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { EmployeePayoutAccountService } from "./employee-payout-account.service";
import { EmployeeService } from "./employee.service";
import { confirmIngestedSchema } from "@validators/ingest.validator";
import { purgeAuditLog } from "@lib/test-fixtures";

// Rules the database itself enforces, so a script, a manual fix or a future service can't write
// the impossible row the current services happen to avoid.

const mobile = () => `+880${Math.floor(1e9 + Math.random() * 8e9)}`;
let adminId: string;
let itemId: string;
let warehouseId: string;
let houseId: string;
let employeeId: string;
let otherEmployeeId: string;
const profileIds: string[] = [];
const employeeIds: string[] = [];

/** Prisma's lazy query isn't a real promise, which `expect(...).rejects` needs. */
const refused = (fn: () => PromiseLike<unknown>) => expect((async () => fn())()).rejects.toThrow();

async function newEmployee(name: string) {
    const p = await prisma.profiles.create({ data: { name, mobile: mobile(), role: "EMPLOYEE" } });
    profileIds.push(p.id);
    const e = await prisma.employees.create({
        data: { profile_id: p.id, role: "WORKER", reference_salary: 10000 },
    });
    employeeIds.push(e.id);
    return e.id;
}

describe("row invariants", () => {
    beforeAll(async () => {
        const admin = await prisma.profiles.create({ data: { name: "Invariant Admin", mobile: mobile(), role: "ADMIN" } });
        adminId = admin.id;
        profileIds.push(admin.id);
        await prisma.admins.create({ data: { profile_id: admin.id } });
        itemId = (
            await prisma.item.create({
                data: { name: `Inv Item ${crypto.randomUUID()}`, normalized_key: `inv item ${crypto.randomUUID()}`, category: "FEED", unit: "BAG" },
            })
        ).id;
        warehouseId = (await prisma.warehouses.create({ data: { name: `Inv WH ${crypto.randomUUID()}` } })).id;
        houseId = (await prisma.houses.create({ data: { name: "Inv House", type: "BROODER", number: Math.floor(Math.random() * 1e6) } })).id;
        employeeId = await newEmployee("Inv Employee");
        otherEmployeeId = await newEmployee("Inv Other");
    });

    afterAll(async () => {
        // Payout accounts are audit-logged against the admin, and a profile with audit rows can't go.
        await purgeAuditLog({ where: { changed_by_id: adminId } });
        await prisma.performanceScoreEntry.deleteMany({ where: { employee_id: { in: employeeIds } } });
        await prisma.employeePayoutAccount.deleteMany({ where: { employee_id: { in: employeeIds } } });
        await prisma.inventoryAdjustment.deleteMany({ where: { item_id: itemId } });
        await prisma.stockLedger.deleteMany({ where: { item_id: itemId } });
        await prisma.employees.deleteMany({ where: { id: { in: employeeIds } } });
        await prisma.admins.deleteMany({ where: { profile_id: adminId } });
        await prisma.item.deleteMany({ where: { id: itemId } });
        await prisma.warehouses.deleteMany({ where: { id: warehouseId } });
        await prisma.houses.deleteMany({ where: { id: houseId } });
        await prisma.profiles.deleteMany({ where: { id: { in: profileIds } } });
    });

    test("every constraint is in place; only the legacy-score notice rule is left unvalidated", async () => {
        const wanted = [
            "Employees_reference_xor",
            "EmployeeTaskAssignment_location_xor",
            "PSE_other_approved",
            "PSE_void_reason",
            "PSE_notice_required",
            "InventoryAdjustment_delta",
            "InventoryAdjustment_one_location",
            "BirdSale_sex_sum",
            "Payment_amount_pos",
            "Expense_amount_pos",
            "StockLedger_qty_pos",
            "Consumption_qty_pos",
            "PurchaseItem_qty_pos",
            "SaleItem_qty_pos",
            "StockTransfer_qty_pos",
            "BHA_qty_pos",
            "MortalityLog_count_pos",
            "BirdSale_count_pos",
        ];
        const rows = await prisma.$queryRaw<{ conname: string; convalidated: boolean }[]>`
            SELECT conname, convalidated FROM pg_constraint WHERE contype = 'c' AND conname = ANY(${wanted})`;
        expect(rows.map((r) => r.conname).sort()).toEqual([...wanted].sort());
        // NOT VALID: one old score entry predates the notice rule; every new or changed row is still checked.
        expect(rows.filter((r) => !r.convalidated).map((r) => r.conname)).toEqual(["PSE_notice_required"]);
    });

    test("an employee's reference is an employee or an outsider, never both", async () => {
        await refused(() =>
            prisma.employees.update({
                where: { id: employeeId },
                data: { reference_employee_id: otherEmployeeId, reference_name: "Outsider", reference_phone: "+8801700000000" },
            }),
        );
        // The service clears the outsider's details when an employee is named, so switching works.
        await EmployeeService.update(employeeId, { reference_name: "Someone", reference_phone: "+8801711111111" } as never);
        const switched = await EmployeeService.update(employeeId, { reference_employee_id: otherEmployeeId } as never);
        expect(switched.reference_employee_id).toBe(otherEmployeeId);
        expect(switched.reference_name).toBeNull();
        expect(switched.reference_phone).toBeNull();
    });

    test("score entries: OTHER needs an approver, a notice at -4 or worse, and a voided one needs its reason", async () => {
        const base = { employee_id: employeeId, given_by_id: adminId, reason: "inv", incident_date: new Date(), idempotency_key: "" };
        const mk = (over: Record<string, unknown>) =>
            prisma.performanceScoreEntry.create({
                data: { ...base, idempotency_key: crypto.randomUUID(), criterion: "NEGLIGENT_LOSS", points: -1, ...over } as never,
            });

        await refused(() => mk({ criterion: "OTHER", points: 2 })); // no approver
        await refused(() => mk({ points: -5 })); // no notice
        await refused(() => mk({ status: "VOIDED" })); // no reason

        // The same rows done properly are fine, and a voided entry needs no notice.
        await mk({ criterion: "OTHER", points: 2, approved_by_id: adminId });
        await mk({ points: -5, notice_doc_url: "https://example.com/n" });
        await mk({ points: -5, status: "VOIDED", void_reason: "entered in error" });
    });

    test("an adjustment states the delta it caused, at exactly one location", async () => {
        const base = {
            item_id: itemId,
            quantity_before: 10,
            quantity_after: 15,
            adjustment_quantity: 5,
            reason: "inv",
            recorded_by_id: adminId,
        };
        const mk = (over: Record<string, unknown>) =>
            prisma.inventoryAdjustment.create({ data: { ...base, idempotency_key: crypto.randomUUID(), ...over } as never });

        await refused(() => mk({ warehouse_id: warehouseId, adjustment_quantity: 99 })); // wrong delta
        await refused(() => mk({})); // no location
        await refused(() => mk({ warehouse_id: warehouseId, house_id: houseId })); // two locations
        await mk({ warehouse_id: warehouseId });
    });

    test("money and quantities that move must be positive", async () => {
        await refused(() =>
            prisma.stockLedger.create({
                data: { item_id: itemId, quantity: 0, direction: "IN", reason: "PURCHASE", ref_type: "PURCHASE", ref_id: crypto.randomUUID(), idempotency_key: crypto.randomUUID() },
            }),
        );
        await refused(() =>
            prisma.expense.create({
                data: { category: "SALARY", cost_type: "SHARED_PERIOD", amount: 0, date: new Date(), recorded_by_id: adminId },
            }),
        );
    });

    test("an employee can't have two open payout accounts, but the service still replaces one cleanly", async () => {
        const create = (n: string) =>
            EmployeePayoutAccountService.create({
                employee_id: employeeId,
                method: "BKASH",
                account_name: "Inv Employee",
                account_number: n,
                verified_by_id: adminId,
            });
        const first = await create("01700000001");
        const second = await create("01700000002"); // closes the first, opens the second
        expect((await prisma.employeePayoutAccount.findUniqueOrThrow({ where: { id: first!.id } })).active_to).not.toBeNull();
        expect(second!.active_to).toBeNull();

        // A direct second open row -- what a race would produce -- is refused by the index.
        await refused(() =>
            prisma.employeePayoutAccount.create({
                data: { employee_id: employeeId, method: "BKASH", account_name: "x", account_number: "01700000003", verified_by_id: adminId, verified_at: new Date() },
            }),
        );

        // Two creates racing through the service: exactly one opens, and the other fails cleanly.
        const results = await Promise.allSettled([create("01700000004"), create("01700000005"), create("01700000006")]);
        expect(await prisma.employeePayoutAccount.count({ where: { employee_id: employeeId, active_to: null } })).toBe(1);
        for (const r of results) if (r.status === "rejected") expect(r.reason).toMatchObject({ status: 409 });
    });

    test("confirming an ingested sale with a sex split that doesn't add up is a validation error, not a database one", () => {
        const base = {
            batch_id: crypto.randomUUID(),
            house_id: crypto.randomUUID(),
            grade: "HIGH",
            birds_count: 10,
            dholta_in_g: 0,
            total_katha: 1,
            total_weight: 20,
            net_weight: 19,
            price_per_kg: 100,
        };
        expect(confirmIngestedSchema.safeParse({ ...base, male_count: 6, female_count: 3 }).success).toBe(false);
        expect(confirmIngestedSchema.safeParse({ ...base, male_count: 6, female_count: 4 }).success).toBe(true);
        expect(confirmIngestedSchema.safeParse({ ...base, male_count: 6 }).success).toBe(true); // only one given
    });
});
