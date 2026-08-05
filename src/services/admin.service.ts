import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { handleUniqueConstraint } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type {
    CreateAdminInput,
    UpdateAdminInput,
    ListAdminsQuery,
} from "@validators/admin.validator";

const include = { profile: true } as const;

export const AdminService = {
    async getAll(query: ListAdminsQuery) {
        const where =
            query.is_active === undefined ? {} : { profile: { is_active: query.is_active } };
        const [admins, total] = await Promise.all([
            prisma.admins.findMany({
                where,
                include,
                orderBy: { created_at: "desc" },
                ...toSkipTake(query),
            }),
            prisma.admins.count({ where }),
        ]);
        return { admins, meta: buildMeta(total, query) };
    },

    async getById(id: string) {
        const admin = await prisma.admins.findUnique({ where: { id }, include });
        if (!admin) throw AppError.notFound("Admin");
        return admin;
    },

    async create(data: CreateAdminInput) {
        try {
            return await prisma.$transaction(async (tx) => {
                const profile = await tx.profiles.create({
                    data: {
                        name: data.name,
                        mobile: data.mobile,
                        role: "ADMIN",
                        ...(data.email !== undefined && { email: data.email }),
                        ...(data.address !== undefined && { address: data.address }),
                    },
                });
                return tx.admins.create({ data: { profile_id: profile.id }, include });
            });
        } catch (err) {
            return handleUniqueConstraint(err);
        }
    },

    async update(id: string, data: UpdateAdminInput) {
        const admin = await prisma.admins.findUnique({ where: { id } });
        if (!admin) throw AppError.notFound("Admin");

        const { name, mobile, email, address } = data;
        if (!name && !mobile && !email && !address) {
            throw AppError.badRequest("No update fields provided");
        }

        try {
            return await prisma.admins.update({
                where: { id },
                data: {
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

    async setActive(id: string, is_active: boolean) {
        const admin = await prisma.admins.findUnique({ where: { id } });
        if (!admin) throw AppError.notFound("Admin");
        await prisma.profiles.update({ where: { id: admin.profile_id }, data: { is_active } });
        return this.getById(id);
    },
};
