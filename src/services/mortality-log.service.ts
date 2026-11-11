import prisma from "@lib/db";
import { assertHouseActive } from "@lib/active-guards";
import { AppError } from "@lib/app-error";
import { audit } from "@lib/audit";
import { farmDay } from "@lib/farm-day";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { assertCaseOfBatch } from "@services/disease-case.service";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type {
    CreateMortalityLogInput,
    ListMortalityLogsQuery,
} from "@validators/mortality-log.validator";

export const MortalityLogService = {
    async getAll(query: ListMortalityLogsQuery) {
        const where = {
            ...(query.batch_id !== undefined && { batch_id: query.batch_id }),
            ...(query.house_id !== undefined && { house_id: query.house_id }),
        };
        const [logs, total] = await Promise.all([
            prisma.mortalityLog.findMany({
                where,
                orderBy: { date: "desc" },
                ...toSkipTake(query),
            }),
            prisma.mortalityLog.count({ where }),
        ]);
        return { logs, meta: buildMeta(total, query) };
    },

    /** Decrements BatchHouseBalance in the same transaction as the log row
     * -- one of only three things allowed to change that balance. */
    async create(data: CreateMortalityLogInput) {
        try {
            return await prisma.$transaction(async (tx) => {
                await assertHouseActive(tx, data.house_id);
                if (data.disease_case_id !== undefined)
                    await assertCaseOfBatch(tx, data.disease_case_id, data.batch_id);
                // Guard and decrement are one statement: two concurrent logs can't both pass a
                // check against the same stale balance, and a conflict writes nothing.
                const { count } = await tx.batchHouseBalance.updateMany({
                    where: {
                        batch_id: data.batch_id,
                        house_id: data.house_id,
                        quantity: { gte: data.count_died },
                    },
                    data: { quantity: { decrement: data.count_died } },
                });
                if (count === 0) {
                    throw AppError.conflict("Mortality count exceeds live birds in this house");
                }

                const log = await tx.mortalityLog.create({
                    data: {
                        batch_id: data.batch_id,
                        house_id: data.house_id,
                        count_died: data.count_died,
                        date: data.date,
                        recorded_by_id: data.recorded_by_id,
                        idempotency_key: data.idempotency_key ?? crypto.randomUUID(),
                        ...(data.cause_note !== undefined && { cause_note: data.cause_note }),
                        ...(data.disease_case_id !== undefined && {
                            disease_case_id: data.disease_case_id,
                        }),
                    },
                });

                return log;
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    /** Admin fix-up for a death logged without its outbreak. The case must be this batch's, name the
     * log's house, and have been active on the farm day the birds died (noticed_on to resolved_on). */
    async setDiseaseCase(id: string, disease_case_id: string | null, actor_id: string) {
        return prisma.$transaction(async (tx) => {
            const log = await tx.mortalityLog.findUnique({ where: { id } });
            if (!log) throw AppError.notFound("Mortality log");

            if (disease_case_id) {
                const found = await tx.diseaseCase.findUnique({
                    where: { id: disease_case_id },
                    select: {
                        batch_id: true,
                        noticed_on: true,
                        resolved_on: true,
                        houses: { select: { id: true } },
                    },
                });
                if (!found) throw AppError.notFound("Disease case");
                if (found.batch_id !== log.batch_id)
                    throw AppError.badRequest("That disease case belongs to another batch");
                if (!found.houses.some((h) => h.id === log.house_id))
                    throw AppError.badRequest("That disease case doesn't cover this house");
                const day = farmDay(log.date);
                if (
                    day < farmDay(found.noticed_on) ||
                    (found.resolved_on && day > farmDay(found.resolved_on))
                )
                    throw AppError.badRequest(
                        "That disease wasn't active on the day these birds died",
                    );
            }

            const updated = await tx.mortalityLog.update({
                where: { id },
                data: { disease_case_id },
            });
            await audit(tx, {
                table: "MortalityLog",
                record_id: id,
                action: "UPDATE",
                actor_id,
                note: disease_case_id
                    ? "Disease linked to mortality log"
                    : "Disease unlinked from mortality log",
                before: { disease_case_id: log.disease_case_id },
                after: { disease_case_id },
            });
            return updated;
        });
    },
};
