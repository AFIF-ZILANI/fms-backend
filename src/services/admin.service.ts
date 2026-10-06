import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { AuthService } from "@services/auth.service";
import { audit } from "@lib/audit";
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
            query.is_active === undefined
                ? {}
                : { profile: { is_active: query.is_active === "true" } };
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

    async create(data: CreateAdminInput, actor_id?: string) {
        try {
            return await prisma.$transaction(async (tx) => {
                const profile = await tx.profiles.create({
                    data: {
                        name: data.name,
                        mobile: data.mobile,
                        role: "ADMIN",
                        email: data.email,
                        ...(data.address !== undefined && { address: data.address }),
                    },
                });
                const admin = await tx.admins.create({ data: { profile_id: profile.id }, include });
                // The creating admin hands the new one this once.
                const temp_password = await AuthService.issueTempPassword(profile.id, tx);
                if (actor_id) {
                    await audit(tx, {
                        table: "Admins",
                        record_id: admin.id,
                        action: "CREATE",
                        actor_id,
                        note: "Admin created, login created",
                        after: { email: profile.email },
                    });
                }
                return { ...admin, temp_password };
            });
        } catch (err) {
            return handlePrismaWriteError(err);
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
            return handlePrismaWriteError(err);
        }
    },

    async setActive(id: string, is_active: boolean, actor_profile_id?: string) {
        const admin = await prisma.admins.findUnique({ where: { id } });
        if (!admin) throw AppError.notFound("Admin");
        if (!is_active) {
            if (admin.profile_id === actor_profile_id) {
                throw AppError.badRequest("You cannot deactivate yourself");
            }
            // Nobody left to log in and fix things.
            const others = await prisma.admins.count({
                where: { id: { not: id }, profile: { is_active: true } },
            });
            if (others === 0) throw AppError.badRequest("Cannot deactivate the last active admin");
        }
        await prisma.profiles.update({ where: { id: admin.profile_id }, data: { is_active } });
        if (actor_profile_id) {
            await audit(prisma, {
                table: "Admins",
                record_id: id,
                action: "UPDATE",
                actor_id: actor_profile_id,
                note: is_active ? "Admin reactivated" : "Admin deactivated",
            });
        }
        return this.getById(id);
    },

    /** Forgot-password recovery (there is no email): a new temp password, shown once. */
    async resetPassword(id: string, actor_profile_id?: string) {
        const admin = await prisma.admins.findUnique({ where: { id }, include });
        if (!admin) throw AppError.notFound("Admin");
        if (admin.profile_id === actor_profile_id) {
            throw AppError.badRequest("Use change password for your own account");
        }
        if (!admin.profile.email) {
            throw AppError.badRequest("Add an email to this admin before resetting their password");
        }
        const temp_password = await AuthService.issueTempPassword(admin.profile_id);
        if (actor_profile_id) {
            await audit(prisma, {
                table: "Admins",
                record_id: id,
                action: "UPDATE",
                actor_id: actor_profile_id,
                note: "Password reset",
            });
        }
        return { temp_password };
    },
};
