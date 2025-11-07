import { ResourceCategory, Unit } from "@/types/enum.type";
import { prisma } from "@/utils/db";
import { faker } from "@faker-js/faker";

console.log("Seeding items (stock)...");

const suppliers = await prisma.supplier.findMany({
    select: { id: true, type: true, name: true },
});

// helper to pick a supplier with a specific type
function getSupplierByCategory(category: string) {
    const validSuppliers = suppliers.filter((s) =>
        s.type.includes(category as any)
    );
    if (validSuppliers.length === 0)
        return faker.helpers.arrayElement(suppliers);
    return faker.helpers.arrayElement(validSuppliers);
}

const items = Array.from({ length: 120 }).map(() => {
    const category = faker.helpers.arrayElement(
        Object.values(ResourceCategory)
    );
    const supplier = getSupplierByCategory(category);
    const reorderLevel = faker.number.int({ min: 10, max: 200 });
    const stock = faker.number.int({ min: 0, max: 500 });

    return {
        name: faker.commerce.productName(),
        description: faker.commerce.productDescription(),
        category: category,
        unit_name: faker.helpers.arrayElement(Object.values(Unit)),
        unit_price: parseFloat(faker.commerce.price({ min: 50, max: 800 })),
        stock_quantity: stock,
        reorder_level: reorderLevel,
        is_consumable: faker.datatype.boolean(),
        supplier_id: supplier.id,
        created_at: faker.date.past({ years: 0.25 }),
        updated_at: faker.date.recent(),
    };
});

await prisma.item.createMany({
    data: items,
    skipDuplicates: true,
});

console.log(`✅ Seeded ${items.length} items with stock data.`);
