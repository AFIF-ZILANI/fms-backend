import { BirdBreed } from "@/types/enum.type";
import { generateBatchId, getLastBatchNumber } from "@/utils/batch-utils";
import { prisma } from "@/utils/db";
import { faker } from "@faker-js/faker";

const supplierIds = (
    await prisma.supplier.findMany({ select: { id: true } })
).map((s) => s.id);

console.log("Seeding batches...");

const batches = Array.from({ length: 50 }).map(async () => {
    const start = faker.date.past({ years: 0.25 });
    const expectedEnd = new Date(start);
    expectedEnd.setDate(
        start.getDate() + 60 + faker.number.int({ min: -5, max: 5 })
    ); // ~2 months ± 5 daysƒ
    const supplierId = faker.helpers.arrayElement(supplierIds);
    const breed = faker.helpers.arrayElement(Object.values(BirdBreed));
    const farmCode = "F01";
    const sectorCode = "POU";
    const productCode = breed.slice(0, 3);
    const lastBatchNo = await getLastBatchNumber(farmCode, sectorCode);
    const batch_id = generateBatchId(
        farmCode,
        sectorCode,
        productCode,
        lastBatchNo
    );
    return {
        start_date: start,
        expected_end_date: expectedEnd,
        received_quantity: faker.number.int({ min: 5000, max: 10000 }),
        supplier_id: supplierId,
        house_no: faker.number.int({ min: 1, max: 5 }),
        is_from_registerd_supplier: faker.datatype.boolean(),
        breed,
        batch_id,
        farm_code: farmCode,
        product_code: breed,
        sector_code: faker.helpers.arrayElement(["POU"]),
    };
});

const createdBatches = await prisma.batch.createMany({
    data: await Promise.all(batches),
    skipDuplicates: true,
});

console.log(`✅ Created ${createdBatches.count} batches.`);
