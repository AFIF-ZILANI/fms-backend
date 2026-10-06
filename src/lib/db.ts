import { PrismaPg } from "@prisma/adapter-pg";
import env from "@config/env";
import { PrismaClient } from "../../prisma/generated/prisma/client";

const globalForPrisma = global as unknown as {
    prisma: PrismaClient;
};

const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
});

const prisma =
    globalForPrisma.prisma ||
    new PrismaClient({
        adapter,
        // Never leaves the DB by accident: nested `include: { profile: true }` is all over
        // the services. Auth reads it with an explicit `select`, which wins over this.
        // Same for Employees.religion: sensitive, and only the single-employee reads and the bonus
        // proposal have a reason to see it (they ask for it explicitly).
        omit: { profiles: { password_hash: true }, employees: { religion: true } },
    });

if (env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
