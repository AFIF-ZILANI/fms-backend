import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type { CreateDoctorInput, ListDoctorsQuery } from "@validators/doctor.validator";

const include = { profile: true } as const;

/**
 * No FEATURES.md page of its own -- Doctors only exist to be referenced via
 * doctor_id on Medications/Vaccinations. No is_active field on the model
 * either, so no update/deactivate here; add them if a real need shows up.
 */
export const DoctorService = {
    async getAll(query: ListDoctorsQuery) {
        const [doctors, total] = await Promise.all([
            prisma.doctors.findMany({
                include,
                orderBy: { created_at: "desc" },
                ...toSkipTake(query),
            }),
            prisma.doctors.count(),
        ]);
        return { doctors, meta: buildMeta(total, query) };
    },

    async getById(id: string) {
        const doctor = await prisma.doctors.findUnique({ where: { id }, include });
        if (!doctor) throw AppError.notFound("Doctor");
        return doctor;
    },

    async create(data: CreateDoctorInput) {
        try {
            return await prisma.$transaction(async (tx) => {
                const profile = await tx.profiles.create({
                    data: {
                        name: data.name,
                        mobile: data.mobile,
                        role: "DOCTOR",
                        ...(data.email !== undefined && { email: data.email }),
                        ...(data.address !== undefined && { address: data.address }),
                    },
                });
                return tx.doctors.create({
                    data: {
                        profile_id: profile.id,
                        ...(data.specialty !== undefined && { specialty: data.specialty }),
                        ...(data.position !== undefined && { position: data.position }),
                        ...(data.degrees !== undefined && { degrees: data.degrees }),
                        ...(data.institution !== undefined && { institution: data.institution }),
                    },
                    include,
                });
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },
};
