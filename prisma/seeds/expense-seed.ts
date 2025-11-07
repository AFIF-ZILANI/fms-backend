import { PrismaClient } from "@prisma/client";
import { faker } from "@faker-js/faker";
import { ResourceCategory, Unit } from "@/types/enum.type";

const prisma = new PrismaClient();

async function seedExpenses() {
    const batches = await prisma.batch.findMany({ select: { id: true } });

    if (batches.length === 0) {
        console.warn("⚠️ No batches found. Seed batches first!");
        return;
    }

    const expensesData = Array.from({ length: 80 }).map(() => {
        const batch = faker.helpers.arrayElement(batches);
        const amount = Number(faker.finance.amount({ min: 500, max: 10000 }));
        const categories = Object.values(ResourceCategory);

        return {
            batch_id: batch.id,
            date: faker.date.recent({ days: 120 }),
            amount,
            unit: faker.helpers.arrayElement(Object.values(Unit)),
            category: faker.helpers.arrayElement(categories),
            description: faker.commerce.productDescription(),
            remarks: faker.lorem.sentence(),
        };
    });

    await prisma.expenses.createMany({ data: expensesData });
    console.log(
        `✅ Inserted ${expensesData.length} expense records successfully.`
    );
}

seedExpenses()
    .catch(console.error)
    .finally(async () => await prisma.$disconnect());
