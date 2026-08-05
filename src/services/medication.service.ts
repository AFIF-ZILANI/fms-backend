import prisma from "@lib/db";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type { CreateMedicationInput, ListMedicationsQuery } from "@validators/medication.validator";

export const MedicationService = {
    async getAll(query: ListMedicationsQuery) {
        const where = { ...(query.batch_id !== undefined && { batch_id: query.batch_id }) };
        const [medications, total] = await Promise.all([
            prisma.medications.findMany({
                where,
                orderBy: { date: "desc" },
                ...toSkipTake(query),
            }),
            prisma.medications.count({ where }),
        ]);
        return { medications, meta: buildMeta(total, query) };
    },

    async create(data: CreateMedicationInput) {
        try {
            return await prisma.medications.create({
                data: {
                    batch_id: data.batch_id,
                    medicine_name: data.medicine_name,
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
