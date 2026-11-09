import prisma from "@lib/db";
import type { Prisma } from "../../prisma/generated/prisma/client";
import { AppError } from "@lib/app-error";
import { audit } from "@lib/audit";
import { defined } from "@lib/defined";
import { assertBatchOpen } from "@lib/batch-guards";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type {
    CreateDiseaseCaseInput,
    ListDiseaseCasesQuery,
    UpdateDiseaseCaseInput,
} from "@validators/disease-case.validator";

const name = { select: { id: true, name: true } } as const;

const include = {
    disease: { select: { id: true, code: true, label: true } },
    houses: { select: { id: true, name: true }, orderBy: { name: "asc" } },
    doctor: { select: { id: true, profile: name } },
    recorded_by: name,
    _count: { select: { medications: true } },
} satisfies Prisma.DiseaseCaseInclude;

/** Houses a case names must have held this batch at some point -- a BatchHouseBalance row exists
 * for every house the batch was ever placed in. */
async function assertHousesOfBatch(
    tx: Prisma.TransactionClient,
    batch_id: string,
    house_ids: string[],
) {
    const ids = [...new Set(house_ids)];
    const held = await tx.batchHouseBalance.count({ where: { batch_id, house_id: { in: ids } } });
    if (held !== ids.length)
        throw AppError.badRequest("Every house must be one this batch was placed in");
    return ids;
}

/** A treatment or death can only point at a case of its own batch. */
export async function assertCaseOfBatch(
    tx: Prisma.TransactionClient,
    disease_case_id: string,
    batch_id: string,
) {
    const found = await tx.diseaseCase.findUnique({
        where: { id: disease_case_id },
        select: { batch_id: true },
    });
    if (!found) throw AppError.notFound("Disease case");
    if (found.batch_id !== batch_id)
        throw AppError.badRequest("That disease case belongs to another batch");
}

/** Deaths linked to each case, summed. */
async function deathsByCase(ids: string[]) {
    if (!ids.length) return new Map<string, number>();
    const rows = await prisma.mortalityLog.groupBy({
        by: ["disease_case_id"],
        where: { disease_case_id: { in: ids } },
        _sum: { count_died: true },
    });
    return new Map(rows.map((r) => [r.disease_case_id ?? "", r._sum.count_died ?? 0]));
}

export const DiseaseCaseService = {
    async getAll(query: ListDiseaseCasesQuery) {
        const where = {
            ...(query.batch_id !== undefined && { batch_id: query.batch_id }),
            ...(query.status !== undefined && { status: query.status }),
        };
        const [cases, total] = await Promise.all([
            prisma.diseaseCase.findMany({
                where,
                include,
                orderBy: { noticed_on: "desc" },
                ...toSkipTake(query),
            }),
            prisma.diseaseCase.count({ where }),
        ]);
        const deaths = await deathsByCase(cases.map((c) => c.id));
        return {
            cases: cases.map(({ _count, ...c }) => ({
                ...c,
                deaths: deaths.get(c.id) ?? 0,
                treatments: _count.medications,
            })),
            meta: buildMeta(total, query),
        };
    },

    /** One case with the treatments and deaths linked to it -- the case timeline. */
    async getById(id: string) {
        const found = await prisma.diseaseCase.findUnique({
            where: { id },
            include: {
                ...include,
                medications: { orderBy: { date: "asc" } },
                mortalityLogs: { orderBy: { date: "asc" }, include: { house: name } },
            },
        });
        if (!found) throw AppError.notFound("Disease case");
        const { _count, ...c } = found;
        return {
            ...c,
            deaths: c.mortalityLogs.reduce((sum, m) => sum + m.count_died, 0),
            treatments: _count.medications,
        };
    },

    async create(data: CreateDiseaseCaseInput) {
        try {
            return await prisma.$transaction(async (tx) => {
                await assertBatchOpen(tx, data.batch_id);
                const house_ids = await assertHousesOfBatch(tx, data.batch_id, data.house_ids);
                return tx.diseaseCase.create({
                    data: {
                        batch_id: data.batch_id,
                        disease_id: data.disease_id,
                        houses: { connect: house_ids.map((id) => ({ id })) },
                        severity: data.severity,
                        symptoms: data.symptoms ?? [],
                        affected_count: data.affected_count ?? null,
                        diagnosis_method: data.diagnosis_method,
                        doctor_id: data.doctor_id ?? null,
                        noticed_on: data.noticed_on,
                        notes: data.notes || null,
                        recorded_by_id: data.recorded_by_id,
                    },
                    include,
                });
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    async update(id: string, data: UpdateDiseaseCaseInput) {
        try {
            return await prisma.$transaction(async (tx) => {
                const existing = await tx.diseaseCase.findUnique({ where: { id } });
                if (!existing) throw AppError.notFound("Disease case");
                const { house_ids, status, resolved_on, outcome, ...fields } = data;

                // Reopening clears how it ended; resolving sets it. Otherwise leave them alone.
                const ending =
                    status === "ACTIVE"
                        ? { status, resolved_on: null, outcome: null }
                        : status === "RESOLVED"
                          ? { status, resolved_on: resolved_on ?? null, outcome: outcome ?? null } // both set: the schema refines it
                          : {};
                const noticed = fields.noticed_on ?? existing.noticed_on;
                const resolved =
                    "resolved_on" in ending ? ending.resolved_on : existing.resolved_on;
                if (resolved && resolved < noticed)
                    throw AppError.badRequest(
                        "Resolved date can't be before the day it was noticed",
                    );

                // Houses go in a second write: Prisma won't take a relation `set` next to raw ids like doctor_id.
                if (house_ids) {
                    const ids = await assertHousesOfBatch(tx, existing.batch_id, house_ids);
                    await tx.diseaseCase.update({
                        where: { id },
                        data: { houses: { set: ids.map((id) => ({ id })) } },
                    });
                }
                return tx.diseaseCase.update({
                    where: { id },
                    data: {
                        ...defined(fields),
                        ...(fields.notes !== undefined && { notes: fields.notes || null }),
                        ...ending,
                    },
                    include,
                });
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    /** For a case entered by mistake. Linked treatments and deaths stay, unlinked (FK SET NULL). */
    async remove(id: string, actor_id: string) {
        await prisma.$transaction(async (tx) => {
            const existing = await tx.diseaseCase.findUnique({
                where: { id },
                include: { houses: { select: { id: true } } },
            });
            if (!existing) throw AppError.notFound("Disease case");
            await audit(tx, {
                table: "DiseaseCase",
                record_id: id,
                action: "DELETE",
                actor_id,
                note: "Disease case removed",
                before: JSON.parse(JSON.stringify(existing)),
            });
            await tx.diseaseCase.delete({ where: { id } });
        });
    },
};
