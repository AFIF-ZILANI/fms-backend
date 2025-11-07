import { cloudinary } from "@/config/cloudinary";
import type { IAvatar } from "@/types";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function removeRecords<
    T extends keyof Omit<
        PrismaClient,
        | "$connect"
        | "$disconnect"
        | "$on"
        | "$transaction"
        | "$use"
        | "$extends"
    >,
>({
    table,
    ids,
    placeholder,
    includeRelations,
}: {
    table: T;
    ids: string[];
    placeholder: string;
    includeRelations?: any;
}) {
    // @ts-ignore dynamic access to Prisma model
    const model = prisma[table] as any;
    if (!model || typeof model.findUnique !== "function") {
        throw new Error(`Invalid Prisma table: ${String(table)}`);
    }

    for (const id of ids) {
        console.log(`Deleting ${placeholder}: ${id}`);

        const record = await model.findUnique({
            where: { id },
            include: {
                avatar: true,
                ...includeRelations,
            },
        });

        if (!record) {
            throw new Error(`Invalid ${placeholder} ID: ${id}`);
        }
        console.log("[record]", record);

        const avatar: IAvatar = (record as any).avatar;
        if (avatar && avatar.public_id) {
            try {
                await cloudinary.uploader.destroy(avatar.public_id);
                await prisma.images.delete({ where: { id: avatar.id } });
            } catch (err) {
                console.error("Cloudinary/Image delete failed:", err);
            }
        }

        await model.delete({ where: { id } });
    }

    console.log(`✅ Successfully deleted ${ids.length} ${placeholder}(s)`);
}
