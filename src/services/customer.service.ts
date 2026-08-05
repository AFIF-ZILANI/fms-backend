import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type {
    CreateCustomerInput,
    UpdateCustomerInput,
    ListCustomersQuery,
} from "@validators/customer.validator";

const include = { profile: true } as const;

export const CustomerService = {
    async getAll(query: ListCustomersQuery) {
        const where = {
            ...(query.is_active !== undefined && { is_active: query.is_active === "true" }),
        };
        const [customers, total] = await Promise.all([
            prisma.customers.findMany({
                where,
                include,
                orderBy: { created_at: "desc" },
                ...toSkipTake(query),
            }),
            prisma.customers.count({ where }),
        ]);
        return { customers, meta: buildMeta(total, query) };
    },

    async getById(id: string) {
        const customer = await prisma.customers.findUnique({ where: { id }, include });
        if (!customer) throw AppError.notFound("Customer");
        return customer;
    },

    async create(data: CreateCustomerInput) {
        try {
            return await prisma.$transaction(async (tx) => {
                const profile = await tx.profiles.create({
                    data: {
                        name: data.name,
                        mobile: data.mobile,
                        role: "CUSTOMER",
                        ...(data.email !== undefined && { email: data.email }),
                        ...(data.address !== undefined && { address: data.address }),
                    },
                });
                return tx.customers.create({
                    data: {
                        profile_id: profile.id,
                        ...(data.company !== undefined && { company: data.company }),
                    },
                    include,
                });
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    async update(id: string, data: UpdateCustomerInput) {
        const customer = await prisma.customers.findUnique({ where: { id } });
        if (!customer) throw AppError.notFound("Customer");

        const { name, mobile, email, address, company, rating } = data;
        if (
            !name &&
            !mobile &&
            !email &&
            address === undefined &&
            company === undefined &&
            rating === undefined
        ) {
            throw AppError.badRequest("No update fields provided");
        }

        try {
            return await prisma.customers.update({
                where: { id },
                data: {
                    ...(company !== undefined && { company }),
                    ...(rating !== undefined && { rating }),
                    profile: {
                        update: {
                            ...(name && { name }),
                            ...(mobile && { mobile }),
                            ...(email && { email }),
                            ...(address !== undefined && { address }),
                        },
                    },
                },
                include,
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    /** Toggles the customer relationship's own is_active, not Profiles.is_active
     * -- same reasoning as SupplierService.setActive. */
    async setActive(id: string, is_active: boolean) {
        const customer = await prisma.customers.findUnique({ where: { id } });
        if (!customer) throw AppError.notFound("Customer");
        return prisma.customers.update({ where: { id }, data: { is_active }, include });
    },
};
