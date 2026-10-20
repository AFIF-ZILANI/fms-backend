import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type {
    CreateDoctorInput,
    UpdateDoctorInput,
    ListDoctorsQuery,
} from "@validators/doctor.validator";

const include = {
    profile: true,
    _count: { select: { medications: true, vaccinations: true } },
} as const;

/**
 * Doctors are referenced via doctor_id on Medications/Vaccinations. The model has no is_active of its
 * own, so deactivating uses the profile's -- a doctor's profile is theirs alone (role DOCTOR).
 */
export const DoctorService = {
    async getAll(query: ListDoctorsQuery) {
        const where = {
            ...(query.is_active !== undefined && {
                profile: { is_active: query.is_active === "true" },
            }),
        };
        const [doctors, total] = await Promise.all([
            prisma.doctors.findMany({
                where,
                include,
                orderBy: { created_at: "desc" },
                ...toSkipTake(query),
            }),
            prisma.doctors.count({ where }),
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

    async update(id: string, data: UpdateDoctorInput) {
        const doctor = await prisma.doctors.findUnique({ where: { id } });
        if (!doctor) throw AppError.notFound("Doctor");

        const { name, mobile, email, address, specialty, position, degrees, institution } = data;
        if (Object.values(data).every((v) => v === undefined)) {
            throw AppError.badRequest("No update fields provided");
        }

        try {
            return await prisma.doctors.update({
                where: { id },
                data: {
                    ...(specialty !== undefined && { specialty }),
                    ...(position !== undefined && { position }),
                    ...(degrees !== undefined && { degrees }),
                    ...(institution !== undefined && { institution }),
                    profile: {
                        update: {
                            ...(name && { name }),
                            ...(mobile && { mobile }),
                            ...(email !== undefined && { email }),
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

    /** Hides the doctor from the treatment pickers; past treatments keep pointing at them. */
    async setActive(id: string, is_active: boolean) {
        const doctor = await prisma.doctors.findUnique({ where: { id } });
        if (!doctor) throw AppError.notFound("Doctor");
        return prisma.doctors.update({
            where: { id },
            data: { profile: { update: { is_active } } },
            include,
        });
    },
};
