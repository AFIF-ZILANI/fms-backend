import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { BirdSaleService } from "@services/bird-sale.service";
import type { ConfirmIngestedInput, IngestSaleInput } from "@validators/ingest.validator";

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

    /** Turns a staged row into a real BirdSale through the normal service, so
     * the BatchHouseBalance decrement and the "exceeds live birds" check apply
     * exactly as they do for a sale typed into the dashboard. */
    async confirm(id: string, input: ConfirmIngestedInput) {
        const row = await prisma.ingestedSale.findUnique({ where: { id } });
        if (!row) throw AppError.notFound("IngestedSale");
        if (row.status !== "PENDING") {
            throw AppError.conflict(`This sale was already ${row.status.toLowerCase()}`);
        }

        const birdSale = await BirdSaleService.create({
            batch_id: input.batch_id,
            house_id: input.house_id,
            sale_date: row.device_sale_date,
            grade: input.grade,
            birds_count: input.birds_count,
            dholta_in_g: input.dholta_in_g,
            total_katha: input.total_katha,
            total_weight: input.total_weight,
            net_weight: input.net_weight,
            price_per_kg: input.price_per_kg,
            paid_amount: input.paid_amount,
            discount_amount: input.discount_amount,
            recorded_by_id: row.recorded_by_id,
            ...(input.customer_id !== undefined && { customer_id: input.customer_id }),
            ...(input.male_count !== undefined && { male_count: input.male_count }),
            ...(input.female_count !== undefined && { female_count: input.female_count }),
            ...(input.avg_wt_per_katha_kg !== undefined && {
                avg_wt_per_katha_kg: input.avg_wt_per_katha_kg,
            }),
            ...(input.avg_weight_g !== undefined && { avg_weight_g: input.avg_weight_g }),
        });

        await prisma.ingestedSale.update({
            where: { id },
            data: {
                status: "CONFIRMED",
                bird_sale_id: birdSale!.id,
                reviewed_by_id: input.reviewed_by_id,
                reviewed_at: new Date(),
            },
        });

        return birdSale!;
    },

    /** Never deletes: a rejected session stays as the record of what arrived. */
    async dismiss(id: string, reason: string, reviewed_by_id: string) {
        const row = await prisma.ingestedSale.findUnique({ where: { id } });
        if (!row) throw AppError.notFound("IngestedSale");
        if (row.status !== "PENDING") {
            throw AppError.conflict(`This sale was already ${row.status.toLowerCase()}`);
        }
        return prisma.ingestedSale.update({
            where: { id },
            data: {
                status: "DISMISSED",
                dismissed_reason: reason,
                reviewed_by_id,
                reviewed_at: new Date(),
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
