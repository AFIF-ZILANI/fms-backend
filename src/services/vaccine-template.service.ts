import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import type { Prisma } from "../../prisma/generated/prisma/client";
import type {
    CreateVaccineTemplateInput,
    ListVaccineTemplatesQuery,
    UpdateVaccineTemplateInput,
    VaccineEntryInput,
} from "@validators/vaccine-template.validator";

const include = {
    entries: {
        orderBy: { day: "asc" },
        include: { item: { select: { id: true, name: true, unit: true } } },
    },
} satisfies Prisma.VaccineTemplateInclude;

// exactOptionalPropertyTypes: Prisma wants null, not a missing key, for an empty optional column.
const toRows = (entries: VaccineEntryInput[]) =>
    entries.map((e) => ({ ...e, method: e.method ?? null, note: e.note ?? null }));

/** A vaccine row must point at a QR-coded item: confirming it means scanning that item's bottles. */
export async function assertVaccineItems(tx: Prisma.TransactionClient, ids: string[]) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return;
    const found = await tx.item.count({ where: { id: { in: unique }, is_unit_tracked: true } });
    if (found !== unique.length)
        throw AppError.badRequest("Every vaccine must be a QR-coded item from the catalog");
}

// ponytail: no pagination -- a farm keeps a handful of templates. Add it if that stops being true.
export const VaccineTemplateService = {
    async getAll(query: ListVaccineTemplatesQuery) {
        return prisma.vaccineTemplate.findMany({
            where: query.active !== undefined ? { is_active: query.active === "true" } : {},
            include,
            orderBy: { name: "asc" },
        });
    },

    async getById(id: string) {
        const template = await prisma.vaccineTemplate.findUnique({ where: { id }, include });
        if (!template) throw AppError.notFound("VaccineTemplate");
        return template;
    },

    async create(data: CreateVaccineTemplateInput) {
        try {
            return await prisma.$transaction(async (tx) => {
                await assertVaccineItems(
                    tx,
                    data.entries.map((e) => e.item_id),
                );
                return tx.vaccineTemplate.create({
                    data: { name: data.name, entries: { create: toRows(data.entries) } },
                    include,
                });
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    async update(id: string, data: UpdateVaccineTemplateInput) {
        try {
            return await prisma.$transaction(async (tx) => {
                if (data.entries) {
                    await assertVaccineItems(
                        tx,
                        data.entries.map((e) => e.item_id),
                    );
                    await tx.vaccineTemplateEntry.deleteMany({ where: { template_id: id } });
                }
                return tx.vaccineTemplate.update({
                    where: { id },
                    data: {
                        ...(data.name !== undefined && { name: data.name }),
                        ...(data.is_active !== undefined && { is_active: data.is_active }),
                        ...(data.entries && { entries: { create: toRows(data.entries) } }),
                    },
                    include,
                });
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },
};
