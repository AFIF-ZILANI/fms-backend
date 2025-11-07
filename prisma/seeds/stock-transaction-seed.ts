import { prisma } from "@/utils/db";
import { faker } from "@faker-js/faker";
import { TransactionType } from "@prisma/client";

console.log("Seeding stock transactions...");

const items = await prisma.item.findMany({
    select: { id: true, unit_price: true, supplier_id: true },
});
const batches = await prisma.batch.findMany({ select: { id: true } });
const suppliers = await prisma.supplier.findMany({ select: { id: true } });

if (items.length === 0 || batches.length === 0) {
    console.warn("⚠️ Skipping transactions: items or batches not found.");
} else {
    const transactions = Array.from({ length: 300 }).map(() => {
        const item = faker.helpers.arrayElement(items);
        const batch = faker.helpers.arrayElement(batches);
        const supplier =
            item.supplier_id || faker.helpers.arrayElement(suppliers).id;

        const transaction_type = faker.helpers.arrayElement(
            Object.values(TransactionType)
        );

        // simulate logic based on type
        let quantity: number;
        switch (transaction_type) {
            case TransactionType.PURCHASE:
                quantity = faker.number.int({ min: 20, max: 300 });
                break;
            case TransactionType.SALE:
                quantity = faker.number.int({ min: 5, max: 150 });
                break;
            case TransactionType.RETURN:
                quantity = faker.number.int({ min: 1, max: 30 });
                break;
            case TransactionType.DAMAGE:
            case TransactionType.ADJUSTMENT:
                quantity = faker.number.int({ min: 1, max: 15 });
                break;
            default:
                quantity = 0;
        }

        const unit_price = item.unit_price;
        const total_price = parseFloat((quantity * unit_price).toFixed(2));

        return {
            item_id: item.id,
            batch_id: batch.id,
            quantity,
            transaction_type,
            date: faker.date.recent({ days: 90 }),
            unit_price,
            total_price,
            supplier_id: supplier,
            remarks: faker.helpers.arrayElement([
                "Routine transaction",
                "Adjustment after audit",
                "Returned due to quality issue",
                "Damaged during handling",
                "New purchase",
            ]),
        };
    });

    await prisma.stockTransaction.createMany({
        data: transactions,
        skipDuplicates: true,
    });

    console.log(`✅ Seeded ${transactions.length} stock transactions.`);
}
