import { AppError } from "@lib/app-error";
import prisma from "@lib/db";
import type { CreateUserInput, UpdateUserInput } from "@validators/user.validator";

export const UserService = {
    async getAll() {
        return prisma.user.findMany({ orderBy: { createdAt: "desc" } });
    },

    async getById(id: string) {
        const user = await prisma.user.findUnique({ where: { id } });
        if (!user) throw AppError.notFound("User");
        return user;
    },

    async create(data: CreateUserInput) {
        const existing = await prisma.user.findUnique({ where: { email: data.email } });
        if (existing) throw AppError.conflict("Email already exists");
        return prisma.user.create({ data });
    },

    async update(id: string, data: UpdateUserInput) {
        const user = await prisma.user.findUnique({ where: { id } });
        if (!user) throw AppError.notFound("User");

        const { name, email } = data;
        if (!name && !email) throw AppError.badRequest("No update fields provided");

        if (email) {
            const emailExists = await prisma.user.findUnique({
                where: { email, NOT: { id } },
            });
            if (emailExists) throw AppError.conflict("Email already exists");
        }

        return prisma.user.update({
            where: { id },
            data: {
                ...(name && { name }),
                ...(email && { email }),
            },
        });
    },

    async remove(id: string) {
        const user = await prisma.user.findUnique({ where: { id } });
        if (!user) throw AppError.notFound("User");
        return prisma.user.delete({ where: { id } });
    },
};
