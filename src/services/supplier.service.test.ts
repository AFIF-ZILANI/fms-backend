import { describe, test, expect, afterAll } from "bun:test";
import prisma from "@lib/db";
import { SupplierService } from "./supplier.service";
import { AppError } from "@lib/app-error";

const mobile = () => `+880${Math.floor(1e9 + Math.random() * 8e9)}`;
const createdIds: string[] = [];

describe("SupplierService", () => {
    afterAll(async () => {
        // ponytail: SupplierSupplyLink has no onDelete: Cascade to Suppliers,
        // so links must be cleared before the supplier row itself.
        await prisma.supplierSupplyLink.deleteMany({ where: { supplier_id: { in: createdIds } } });
        await prisma.suppliers.deleteMany({ where: { id: { in: createdIds } } });
        await prisma.profiles.deleteMany({
            where: { suppliers: { id: { in: createdIds } } },
        });
    });

    test("create then getById round-trips", async () => {
        const supplier = await SupplierService.create({
            name: "Feed Co",
            mobile: mobile(),
            role: "DISTRIBUTOR",
            supplies: ["FEED", "MEDICINE"],
        });
        createdIds.push(supplier!.id);

        const found = await SupplierService.getById(supplier!.id);
        expect(found.profile.name).toBe("Feed Co");
        expect(found.profile.role).toBe("SUPPLIER");
        expect(found.role).toBe("DISTRIBUTOR");
        expect(found.supplies).toEqual(["FEED", "MEDICINE"]);
        expect(found.is_active).toBe(true);
    });

    test("duplicate mobile throws a conflict", async () => {
        const sharedMobile = mobile();
        const first = await SupplierService.create({
            name: "First",
            mobile: sharedMobile,
            role: "DEALER",
            supplies: ["CHICKS"],
        });
        createdIds.push(first!.id);

        await expect(
            SupplierService.create({
                name: "Second",
                mobile: sharedMobile,
                role: "DEALER",
                supplies: ["CHICKS"],
            }),
        ).rejects.toMatchObject({ status: 409 });
    });

    test("getById on unknown id throws not-found", async () => {
        await expect(
            SupplierService.getById("00000000-0000-0000-0000-000000000000"),
        ).rejects.toBeInstanceOf(AppError);
    });

    test("update with no fields throws bad-request", async () => {
        const supplier = await SupplierService.create({
            name: "Updatable",
            mobile: mobile(),
            role: "WHOLESALER",
            supplies: ["EQUIPMENT"],
        });
        createdIds.push(supplier!.id);

        await expect(SupplierService.update(supplier!.id, {})).rejects.toMatchObject({
            status: 400,
        });
    });

    test("setActive toggles Suppliers.is_active, not Profiles.is_active", async () => {
        const supplier = await SupplierService.create({
            name: "Togglable",
            mobile: mobile(),
            role: "RETAILER",
            supplies: ["HUSK"],
        });
        createdIds.push(supplier!.id);

        const deactivated = await SupplierService.setActive(supplier!.id, false);
        expect(deactivated.is_active).toBe(false);
        expect(deactivated.profile.is_active).toBe(true);

        const reactivated = await SupplierService.setActive(supplier!.id, true);
        expect(reactivated.is_active).toBe(true);
    });

    test("listing filters by supplies category", async () => {
        const supplier = await SupplierService.create({
            name: "FilterMe",
            mobile: mobile(),
            role: "MANUFACTURER",
            supplies: ["UTILITIES"],
        });
        createdIds.push(supplier!.id);

        const { suppliers } = await SupplierService.getAll({
            page: 1,
            limit: 100,
            supplies: "UTILITIES",
        });
        expect(suppliers.some((s) => s.id === supplier!.id)).toBe(true);
        expect(suppliers.every((s) => s.supplies.includes("UTILITIES"))).toBe(true);
    });
});

const createdSupplierIds: string[] = [];

describe("SupplierService supplies (join-table backed)", () => {
    afterAll(async () => {
        // ponytail: SupplierSupplyLink has no onDelete: Cascade to Suppliers,
        // and Profiles isn't cascade-deleted from Suppliers either, so both
        // must be cleared before/alongside the supplier row to keep re-runs
        // idempotent (fixed mobiles below would otherwise conflict).
        await prisma.supplierSupplyLink.deleteMany({
            where: { supplier_id: { in: createdSupplierIds } },
        });
        await prisma.suppliers.deleteMany({ where: { id: { in: createdSupplierIds } } });
        await prisma.profiles.deleteMany({
            where: { mobile: { in: ["01700000001", "01700000002", "01700000003"] } },
        });
    });

    test("create writes supplies through SupplierSupplyLink and returns them as codes", async () => {
        const supplier = await SupplierService.create({
            name: "Test Supplier",
            mobile: "01700000001",
            role: "DEALER",
            supplies: ["FEED", "MEDICINE"],
        });
        createdSupplierIds.push(supplier.id);
        expect(supplier.supplies.sort()).toEqual(["FEED", "MEDICINE"]);
    });

    test("update replaces the supplies set", async () => {
        const supplier = await SupplierService.create({
            name: "Test Supplier 2",
            mobile: "01700000002",
            role: "DEALER",
            supplies: ["FEED"],
        });
        createdSupplierIds.push(supplier.id);

        const updated = await SupplierService.update(supplier.id, { supplies: ["CHICKS", "HUSK"] });
        expect(updated.supplies.sort()).toEqual(["CHICKS", "HUSK"]);
    });

    test("getById returns supplies as codes", async () => {
        const supplier = await SupplierService.create({
            name: "Test Supplier 3",
            mobile: "01700000003",
            role: "DEALER",
            supplies: ["EQUIPMENT"],
        });
        createdSupplierIds.push(supplier.id);

        const found = await SupplierService.getById(supplier.id);
        expect(found.supplies).toEqual(["EQUIPMENT"]);
    });

    test("create rejects an unknown supply category code", async () => {
        await expect(
            SupplierService.create({
                name: "Bad Code Supplier",
                mobile: "01700000099",
                role: "DEALER",
                supplies: ["NOT_A_REAL_CODE"],
            }),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("update rejects an unknown supply category code", async () => {
        const supplier = await SupplierService.create({
            name: "Test Supplier 4",
            mobile: mobile(),
            role: "DEALER",
            supplies: ["FEED"],
        });
        createdSupplierIds.push(supplier.id);

        await expect(
            SupplierService.update(supplier.id, { supplies: ["NOT_A_REAL_CODE"] }),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("create rejects a deactivated supply category code", async () => {
        const inactive = await prisma.supplierSupplyCategory.create({
            data: { code: "TEST_INACTIVE_CODE", label: "Inactive test code", is_active: false },
        });
        try {
            await expect(
                SupplierService.create({
                    name: "Deactivated Code Supplier",
                    mobile: "01700000098",
                    role: "DEALER",
                    supplies: ["TEST_INACTIVE_CODE"],
                }),
            ).rejects.toMatchObject({ status: 400 });
        } finally {
            await prisma.supplierSupplyCategory.delete({ where: { id: inactive.id } });
        }
    });
});
