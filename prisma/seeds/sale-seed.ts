import { PrismaClient } from "@prisma/client";
import { faker } from "@faker-js/faker";

const prisma = new PrismaClient();

async function seedSales() {
    const items = await prisma.item.findMany({
        select: { id: true, unit_price: true },
    });
    const batches = await prisma.batch.findMany({ select: { id: true } });
    const customers = await prisma.customer.findMany({ select: { id: true } });

    if (items.length === 0 || batches.length === 0 || customers.length === 0) {
        console.warn(
            "⚠️ Missing items, batches, or customers. Seed them first!"
        );
        return;
    }

    const salesData = Array.from({ length: 100 }).map(() => {
        const item = faker.helpers.arrayElement(items);
        const batch = faker.helpers.arrayElement(batches);
        const customer = faker.helpers.arrayElement(customers);
        const quantity = faker.number.int({ min: 1, max: 200 });
        const unit_price = item.unit_price;
        const total_price = unit_price * quantity;

        return {
            batch_id: batch.id,
            item_id: item.id,
            quantity,
            delay_for_sale: faker.number.int({ min: 0, max: 10 }),
            unit_price,
            total_price,
            customer_id: customer.id,
            date: faker.date.recent({ days: 90 }),
        };
    });

    await prisma.sales.createMany({ data: salesData });
    console.log(`✅ Inserted ${salesData.length} Sales records successfully.`);
}

seedSales()
    .catch(console.error)
    .finally(async () => await prisma.$disconnect());
