import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { handleUniqueConstraint } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type {
    CreateSupplierInput,
    UpdateSupplierInput,
    ListSuppliersQuery,
} from "@validators/supplier.validator";

const include = { profile: true } as const;

export const SupplierService = {
    async getAll(query: ListSuppliersQuery) {
        const where = {
            ...(query.role !== undefined && { role: query.role }),
            ...(query.supplies !== undefined && { supplies: { has: query.supplies } }),
            ...(query.is_active !== undefined && { is_active: query.is_active === "true" }),
        };
        const [suppliers, total] = await Promise.all([
            prisma.suppliers.findMany({
                where,
                include,
                orderBy: { created_at: "desc" },
                ...toSkipTake(query),
            }),
            prisma.suppliers.count({ where }),
        ]);
        return { suppliers, meta: buildMeta(total, query) };
    },

    async getById(id: string) {
        const supplier = await prisma.suppliers.findUnique({ where: { id }, include });
        if (!supplier) throw AppError.notFound("Supplier");
        return supplier;
    },

    async create(data: CreateSupplierInput) {
        try {
            return await prisma.$transaction(async (tx) => {
                const profile = await tx.profiles.create({
                    data: {
                        name: data.name,
                        mobile: data.mobile,
                        role: "SUPPLIER",
                        ...(data.email !== undefined && { email: data.email }),
                        ...(data.address !== undefined && { address: data.address }),
                    },
                });
                return tx.suppliers.create({
                    data: {
                        profile_id: profile.id,
                        role: data.role,
                        supplies: data.supplies,
                        ...(data.company !== undefined && { company: data.company }),
                    },
                    include,
                });
            });
        } catch (err) {
            return handleUniqueConstraint(err);
        }
    },

    async update(id: string, data: UpdateSupplierInput) {
        const supplier = await prisma.suppliers.findUnique({ where: { id } });
        if (!supplier) throw AppError.notFound("Supplier");

        const { name, mobile, email, address, role, supplies, company } = data;
        if (
            !name &&
            !mobile &&
            !email &&
            address === undefined &&
            !role &&
            !supplies &&
            company === undefined
        ) {
            throw AppError.badRequest("No update fields provided");
        }

        try {
            return await prisma.suppliers.update({
                where: { id },
                data: {
                    ...(role && { role }),
                    ...(supplies && { supplies }),
                    ...(company !== undefined && { company }),
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
            return handleUniqueConstraint(err);
        }
    },

    /** Toggles the supplier *relationship*, not the underlying Profile --
     * Suppliers carries its own is_active distinct from Profiles.is_active
     * (see full-schema-analysis.md). A supplier going inactive doesn't mean
     * their person record should. */
    async setActive(id: string, is_active: boolean) {
        const supplier = await prisma.suppliers.findUnique({ where: { id } });
        if (!supplier) throw AppError.notFound("Supplier");
        return prisma.suppliers.update({ where: { id }, data: { is_active }, include });
    },
};
