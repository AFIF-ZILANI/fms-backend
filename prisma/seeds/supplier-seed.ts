import { PrismaClient } from "@prisma/client";
import { faker } from "@faker-js/faker";
import {
    ContactMethod,
    SupplierRole,
    SupplierSupplyCategory,
} from "@/types/enum.type";

const prisma = new PrismaClient();

async function main() {
    console.log("Seeding suppliers...");

    const suppliers = Array.from({ length: 15 }).map(() => ({
        name: faker.company.name(),
        email: faker.internet.email(),
        mobile: "01" + faker.string.numeric(9),
        address: faker.location.streetAddress(),
        rating: faker.number.float({ min: 3, max: 5, fractionDigits: 1 }),
        role: faker.helpers.arrayElement(Object.values(SupplierRole)),
        type: faker.helpers.arrayElements(
            Object.values(SupplierSupplyCategory),
            faker.number.int({ min: 1, max: 3 })
        ),
        company: faker.company.name(),
        online_contact: faker.helpers.arrayElements(
            Object.values(ContactMethod),
            2
        ),
    }));

    const createdSuppliers = await prisma.supplier.createMany({
        data: suppliers,
        skipDuplicates: true,
    });

    console.log(`✅ Created ${createdSuppliers.count} suppliers.`);
}
main();
