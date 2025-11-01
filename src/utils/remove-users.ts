import { throwError } from "@/utils/error";
import { prisma } from "@/utils/db";
import { cloudinary } from "@/config/cloudinary";

export async function RemoveUsers(ids: string[], placeholder: string) {
    await Promise.all(
        ids.map(async (id) => {
            // Fetch supplier with avatar
            const user = await prisma.supplier.findUnique({
                where: { id },
                include: { avatar: true }, // adjust relation name if needed
            });

            // console.log(user)
            if (!user) {
                throwError({
                    message: `Invalid ${placeholder} Id`,
                    statusCode: 400,
                });
            }

            // Delete avatar from Cloudinary if exists
            if (user.avatar?.public_id) {
                await cloudinary.uploader.destroy(user.avatar.public_id);
            }

            // Delete avatar record from DB
            if (user.avatar) {
                await prisma.images.delete({
                    where: { id: user.avatar.id },
                });
            }

            // Delete supplier record
            await prisma.supplier.delete({
                where: { id },
            });
        })
    );
}
