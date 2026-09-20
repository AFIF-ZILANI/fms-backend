import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import type { IngestSaleInput } from "@validators/ingest.validator";

/** The device reads its own clock with no NTP check and the user can change it,
 * so sale_date is a claim, not a fact. Anything beyond this window is refused;
 * everything else is kept alongside the server's own received_at. */
export const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

type DeviceCtx = { device_id: string; profile_id: string };

export const IngestService = {
    /** One weighing session becomes up to two staging rows -- the main portion
     * always, the cull portion only when it was actually sold. That is why the
     * device's sale id alone cannot be the idempotency key. */
    async ingest(input: IngestSaleInput, ctx: DeviceCtx) {
        if (input.sale_date.getTime() > Date.now() + MAX_FUTURE_MS) {
            throw AppError.badRequest("sale_date is too far in the future");
        }

        const portions: string[] = ["main"];
        if (input.has_cull && input.cull?.is_sold) portions.push("cull");

        try {
            const rows = [];
            for (const portion of portions) {
                const idempotency_key = `${input.sale_id}:${portion}`;
                const existing = await prisma.ingestedSale.findUnique({
                    where: { idempotency_key },
                    select: { id: true },
                });
                if (existing) continue;

                const created = await prisma.ingestedSale.create({
                    data: {
                        idempotency_key,
                        portion,
                        device_id: ctx.device_id,
                        recorded_by_id: ctx.profile_id,
                        device_sale_date: input.sale_date,
                        payload: input as unknown as object,
                    },
                    select: { id: true, idempotency_key: true, portion: true },
                });
                rows.push(created);
            }
            return { created: rows.length, rows };
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    async list(status?: string) {
        return prisma.ingestedSale.findMany({
            where: { ...(status !== undefined && { status }) },
            orderBy: { received_at: "desc" },
            include: {
                recorded_by: { select: { id: true, name: true } },
                device: { select: { id: true, label: true } },
            },
        });
    },

    async getById(id: string) {
        const row = await prisma.ingestedSale.findUnique({
            where: { id },
            include: {
                recorded_by: { select: { id: true, name: true } },
                device: { select: { id: true, label: true } },
            },
        });
        if (!row) throw AppError.notFound("IngestedSale");
        return row;
    },
};
