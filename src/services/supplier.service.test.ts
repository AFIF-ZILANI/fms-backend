import { describe, test, expect, afterAll } from "bun:test";
import prisma from "@lib/db";
import { SupplierService } from "./supplier.service";
import { AppError } from "@lib/app-error";

const mobile = () => `+880${Math.floor(1e9 + Math.random() * 8e9)}`;
const createdIds: string[] = [];

describe("SupplierService", () => {
    afterAll(async () => {
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
