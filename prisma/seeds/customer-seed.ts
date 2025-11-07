import { prisma } from "@/utils/db";
import { faker } from "@faker-js/faker";
import { ContactMethod } from "@prisma/client";

async function main() {
    await prisma.customer.createManyAndReturn({
        data: Array.from({ length: 100 }).map(() => ({
            name: faker.person.fullName(),
            email: faker.internet.email(),
            mobile: "01" + faker.string.numeric(9),
            address: faker.location.streetAddress(),
            rating: faker.number.float({ min: 0, max: 5 }),
            company: faker.company.name(),
            is_registered: faker.datatype.boolean(),
            online_contact: faker.helpers.arrayElements(
                Object.values(ContactMethod),
                2
            ),
        })),
    });

    console.log("✅ Seeded successfully!");
}
main();
