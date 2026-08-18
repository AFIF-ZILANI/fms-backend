// server/scripts/backfill-lookup-tables.ts
import prisma from "../src/lib/db";

/** "CLEANING_SUPPLIES" -> "Cleaning Supplies" */
function humanize(code: string): string {
    return code
        .toLowerCase()
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
}

const ITEM_CATEGORIES = [
    "FEED", "MEDICINE", "VACCINE", "SUPPLEMENT", "BIOSECURITY", "CHICKS",
    "HUSK", "EQUIPMENT", "UTILITIES", "SALARY", "TRANSPORTATION",
    "MAINTENANCE", "CLEANING_SUPPLIES", "WASTE", "OTHER",
];

const UNITS = [
    "BIRD", "KG", "LITER", "BAG", "BOX", "UNIT", "SACHETS", "BOTTLE",
    "ML", "L", "G", "PCS", "VIAL", "DOSE", "OTHER",
];

const EXPENSE_CATEGORIES = [
    "LABOR", "ELECTRICITY", "WATER", "RENT", "TRANSPORT", "FUEL",
    "MAINTENANCE", "VET_FEE", "INTERNET", "MISC",
];

const SUPPLY_CATEGORIES = [
    "FEED", "MEDICINE", "CHICKS", "HUSK", "EQUIPMENT", "UTILITIES",
    "TRANSPORTATION", "CLEANING_SUPPLIES", "OFFICE_SUPPLIES", "SOFTWARE", "OTHER",
];

async function seed<T extends { upsert(args: unknown): Promise<unknown> }>(
    delegate: T,
    codes: string[],
) {
    for (const code of codes) {
        await delegate.upsert({
            where: { code },
            create: { code, label: humanize(code) },
            update: {},
        });
    }
}

async function main() {
    console.log("Seeding ItemCategory...");
    await seed(prisma.itemCategory, ITEM_CATEGORIES);

    console.log("Seeding Unit...");
    await seed(prisma.unit, UNITS);

    console.log("Seeding ExpenseCategory...");
    await seed(prisma.expenseCategoryLookup, EXPENSE_CATEGORIES);

    console.log("Seeding SupplierSupplyCategory...");
    await seed(prisma.supplierSupplyCategory, SUPPLY_CATEGORIES);

    console.log("Migrating Suppliers.supplies[] into SupplierSupplyLink...");
    const suppliers = await prisma.suppliers.findMany({ select: { id: true, supplies: true } });
    const supplyCategoryRows = await prisma.supplierSupplyCategory.findMany();
    const idByCode = new Map(supplyCategoryRows.map((r) => [r.code, r.id]));

    for (const supplier of suppliers) {
        for (const code of supplier.supplies) {
            const category_id = idByCode.get(code);
            if (!category_id) {
                throw new Error(`No SupplierSupplyCategory seeded for code ${code} (supplier ${supplier.id})`);
            }
            await prisma.supplierSupplyLink.upsert({
                where: { supplier_id_category_id: { supplier_id: supplier.id, category_id } },
                create: { supplier_id: supplier.id, category_id },
                update: {},
            });
        }
    }

    console.log("Done.");
}

main()
    .catch((err) => {
        console.error(err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
