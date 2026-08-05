import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import { normalizeKey } from "@lib/normalize";
import type {
    CreateOrganizationInput,
    UpdateOrganizationInput,
    ListOrganizationsQuery,
    CreateItemOrganizationInput,
} from "@validators/organization.validator";

export const OrganizationService = {
    async getAll(query: ListOrganizationsQuery) {
        const [organizations, total] = await Promise.all([
            prisma.organization.findMany({ orderBy: { created_at: "desc" }, ...toSkipTake(query) }),
            prisma.organization.count(),
        ]);
        return { organizations, meta: buildMeta(total, query) };
    },

    async getById(id: string) {
        const organization = await prisma.organization.findUnique({
            where: { id },
            include: { itemLinks: { include: { item: true } } },
        });
        if (!organization) throw AppError.notFound("Organization");
        return organization;
    },

    async create(data: CreateOrganizationInput) {
        try {
            return await prisma.organization.create({
                data: {
                    label_name: data.label_name,
                    normalized_key: normalizeKey(data.label_name),
                },
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    async update(id: string, data: UpdateOrganizationInput) {
        const organization = await prisma.organization.findUnique({ where: { id } });
        if (!organization) throw AppError.notFound("Organization");
        if (!data.label_name) throw AppError.badRequest("No update fields provided");

        try {
            return await prisma.organization.update({
                where: { id },
                data: {
                    label_name: data.label_name,
                    normalized_key: normalizeKey(data.label_name),
                },
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },
};

export const ItemOrganizationService = {
    async create(data: CreateItemOrganizationInput) {
        try {
            return await prisma.itemOrganization.create({
                data,
                include: { item: true, organization: true },
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    async remove(id: string) {
        const link = await prisma.itemOrganization.findUnique({ where: { id } });
        if (!link) throw AppError.notFound("ItemOrganization link");
        await prisma.itemOrganization.delete({ where: { id } });
    },
};
