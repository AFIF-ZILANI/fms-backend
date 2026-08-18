import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type {
    CreateSupplierInput,
    UpdateSupplierInput,
    ListSuppliersQuery,
} from "@validators/supplier.validator";

const include = { profile: true, supplyLinks: { include: { category: true } } } as const;

/** Suppliers.supplies moved from a scalar enum array to a SupplierSupplyLink
 * join table (2026-08-18 lookup-tables migration), but every caller outside
 * this service still expects `supplies: string[]` of codes -- this shape
 * is reconstructed here so nothing downstream (frontend included) has to
 * change how it reads a Supplier. */
function toSupplierShape<T extends { supplyLinks: { category: { code: string } }[] }>(
    supplier: T,
): Omit<T, "supplyLinks"> & { supplies: string[] } {
    const { supplyLinks, ...rest } = supplier;
    return { ...rest, supplies: supplyLinks.map((link) => link.category.code) };
}

export const SupplierService = {
    async getAll(query: ListSuppliersQuery) {
        const where = {
            ...(query.role !== undefined && { role: query.role }),
            ...(query.supplies !== undefined && {
                supplyLinks: { some: { category: { code: query.supplies } } },
            }),
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
        return { suppliers: suppliers.map(toSupplierShape), meta: buildMeta(total, query) };
    },

    async getById(id: string) {
        const supplier = await prisma.suppliers.findUnique({ where: { id }, include });
        if (!supplier) throw AppError.notFound("Supplier");
        return toSupplierShape(supplier);
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
                const categories = await tx.supplierSupplyCategory.findMany({
                    where: { code: { in: data.supplies }, is_active: true },
                });
                if (categories.length !== data.supplies.length) {
                    throw AppError.badRequest("One or more supply categories are unknown or inactive");
                }
                const supplier = await tx.suppliers.create({
                    data: {
                        profile_id: profile.id,
                        role: data.role,
                        ...(data.company !== undefined && { company: data.company }),
                        supplyLinks: {
                            create: categories.map((cat) => ({ category_id: cat.id })),
                        },
                    },
                    include,
                });
                return toSupplierShape(supplier);
            });
        } catch (err) {
            return handlePrismaWriteError(err);
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
            return await prisma.$transaction(async (tx) => {
                if (supplies) {
                    const categories = await tx.supplierSupplyCategory.findMany({
                        where: { code: { in: supplies }, is_active: true },
                    });
                    if (categories.length !== supplies.length) {
                        throw AppError.badRequest("One or more supply categories are unknown or inactive");
                    }
                    await tx.supplierSupplyLink.deleteMany({ where: { supplier_id: id } });
                    await tx.supplierSupplyLink.createMany({
                        data: categories.map((cat) => ({ supplier_id: id, category_id: cat.id })),
                    });
                }

                const updated = await tx.suppliers.update({
                    where: { id },
                    data: {
                        ...(role && { role }),
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
                return toSupplierShape(updated);
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    /** Toggles the supplier *relationship*, not the underlying Profile --
     * Suppliers carries its own is_active distinct from Profiles.is_active
     * (see full-schema-analysis.md). A supplier going inactive doesn't mean
     * their person record should. */
    async setActive(id: string, is_active: boolean) {
        const supplier = await prisma.suppliers.findUnique({ where: { id } });
        if (!supplier) throw AppError.notFound("Supplier");
        const updated = await prisma.suppliers.update({ where: { id }, data: { is_active }, include });
        return toSupplierShape(updated);
    },
};
