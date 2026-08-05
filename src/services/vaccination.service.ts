import prisma from "@lib/db";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type {
    CreateVaccinationInput,
    ListVaccinationsQuery,
} from "@validators/vaccination.validator";

export const VaccinationService = {
    async getAll(query: ListVaccinationsQuery) {
        const where = { ...(query.batch_id !== undefined && { batch_id: query.batch_id }) };
        const [vaccinations, total] = await Promise.all([
            prisma.vaccinations.findMany({
                where,
                orderBy: { date: "desc" },
                ...toSkipTake(query),
            }),
            prisma.vaccinations.count({ where }),
        ]);
        return { vaccinations, meta: buildMeta(total, query) };
    },

    async create(data: CreateVaccinationInput) {
        try {
            return await prisma.vaccinations.create({
                data: {
                    batch_id: data.batch_id,
                    vaccine_name: data.vaccine_name,
                    dosage: data.dosage,
                    administered_by_id: data.administered_by_id,
                    idempotency_key: data.idempotency_key ?? crypto.randomUUID(),
                    ...(data.consumption_id !== undefined && {
                        consumption_id: data.consumption_id,
                    }),
                    ...(data.cause !== undefined && { cause: data.cause }),
                    ...(data.period !== undefined && { period: data.period }),
                    ...(data.doctor_id !== undefined && { doctor_id: data.doctor_id }),
                    ...(data.remarks !== undefined && { remarks: data.remarks }),
                    ...(data.date !== undefined && { date: data.date }),
                },
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },
};
