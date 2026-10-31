import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { audit } from "@lib/audit";
import { cycleDay } from "@lib/farm-day";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { drawConsumption } from "@services/consumption.service";
import type { Prisma } from "../../prisma/generated/prisma/client";
import type {
    ApplyVaccineTemplateInput,
    CancelVaccineInput,
    ConfirmVaccineInput,
    CreateBatchVaccineScheduleInput,
    RescheduleVaccineInput,
    UpdateBatchVaccineScheduleInput,
} from "@validators/batch-vaccine-schedule.validator";

type Tx = Prisma.TransactionClient;

const include = {
    purposeRef: { select: { code: true, label: true } },
    confirmed_by: { select: { id: true, name: true } },
    vaccinations: {
        select: {
            id: true,
            dosage: true,
            vaccine_name: true,
            consumption: {
                select: {
                    quantity: true,
                    unit: true,
                    stock_unit_id: true,
                    house: { select: { id: true, name: true } },
                },
            },
        },
    },
} satisfies Prisma.BatchVaccineScheduleInclude;

const TABLE = "BatchVaccineSchedule";

/** Row-locks the schedule row so two confirms (or a confirm and a cancel) can't both go through. */
async function lockRow(tx: Tx, id: string) {
    await tx.$executeRaw`SELECT 1 FROM "BatchVaccineSchedule" WHERE id = ${id} FOR UPDATE`;
    const row = await tx.batchVaccineSchedule.findUnique({ where: { id } });
    if (!row) throw AppError.notFound("BatchVaccineSchedule");
    return row;
}

async function lockPending(tx: Tx, id: string) {
    const row = await lockRow(tx, id);
    if (row.status !== "PENDING")
        throw AppError.conflict(`This vaccine is already ${row.status.toLowerCase()}`);
    return row;
}

/** The house a coded unit sits in now, or null for the warehouse. Same lookup assertUnitInHouse uses. */
async function unitHouse(tx: Tx, stock_unit_id: string) {
    const latest = await tx.stockHouseAllocation.findFirst({
        where: { stock_unit_id },
        orderBy: [{ occurred_at: "desc" }, { created_at: "desc" }],
        select: { house_id: true },
    });
    return latest?.house_id ?? null;
}

const run = async <T>(fn: (tx: Tx) => Promise<T>) => {
    try {
        return await prisma.$transaction(fn);
    } catch (err) {
        return handlePrismaWriteError(err);
    }
};

export const BatchVaccineScheduleService = {
    async getAll(batch_id: string) {
        return prisma.batchVaccineSchedule.findMany({
            where: { batch_id },
            include,
            orderBy: [{ day: "asc" }, { created_at: "asc" }],
        });
    },

    /** Copies a template's rows into the batch. Only onto an empty schedule -- afterwards rows are
     *  added one at a time, so a second apply can't silently double every vaccine. */
    async apply(data: ApplyVaccineTemplateInput, actor_id: string) {
        return run(async (tx) => {
            // Serialises two applies on the same batch; the count below is then reliable.
            await tx.$executeRaw`SELECT 1 FROM "Batches" WHERE id = ${data.batch_id} FOR UPDATE`;
            if ((await tx.batchVaccineSchedule.count({ where: { batch_id: data.batch_id } })) > 0)
                throw AppError.conflict("This batch already has a vaccine schedule");
            const template = await tx.vaccineTemplate.findUnique({
                where: { id: data.template_id },
                include: { entries: true },
            });
            if (!template) throw AppError.notFound("VaccineTemplate");
            if (!template.is_active) throw AppError.conflict("That template is archived");

            await tx.batchVaccineSchedule.createMany({
                data: template.entries.map((e) => ({
                    batch_id: data.batch_id,
                    template_id: template.id,
                    purpose: e.purpose,
                    method: e.method,
                    note: e.note,
                    planned_day: e.day,
                    day: e.day,
                })),
            });
            await audit(tx, {
                table: TABLE,
                record_id: data.batch_id,
                action: "CREATE",
                actor_id,
                note: `Vaccine template "${template.name}" applied`,
            });
            return tx.batchVaccineSchedule.findMany({
                where: { batch_id: data.batch_id },
                include,
                orderBy: [{ day: "asc" }, { created_at: "asc" }],
            });
        });
    },

    async create(data: CreateBatchVaccineScheduleInput, actor_id: string) {
        return run(async (tx) => {
            const row = await tx.batchVaccineSchedule.create({
                data: {
                    batch_id: data.batch_id,
                    purpose: data.purpose,
                    method: data.method ?? null,
                    note: data.note ?? null,
                    planned_day: data.day,
                    day: data.day,
                },
                include,
            });
            await audit(tx, {
                table: TABLE,
                record_id: row.id,
                action: "CREATE",
                actor_id,
                note: `Vaccine added on day ${data.day}`,
            });
            return row;
        });
    },

    /** A correction, not a reschedule: a new day here moves planned_day too. */
    async update(id: string, data: UpdateBatchVaccineScheduleInput, actor_id: string) {
        return run(async (tx) => {
            const before = await lockPending(tx, id);
            const row = await tx.batchVaccineSchedule.update({
                where: { id },
                data: {
                    ...(data.purpose !== undefined && { purpose: data.purpose }),
                    ...(data.method !== undefined && { method: data.method }),
                    ...(data.note !== undefined && { note: data.note }),
                    ...(data.day !== undefined && { day: data.day, planned_day: data.day }),
                },
                include,
            });
            await audit(tx, {
                table: TABLE,
                record_id: id,
                action: "UPDATE",
                actor_id,
                note: "Vaccine edited",
                before: { day: before.day, purpose: before.purpose },
                after: { day: row.day, purpose: row.purpose },
            });
            return row;
        });
    },

    /** For mistakes only; a vaccine that was really skipped is cancelled, so the reason stays on record. */
    async remove(id: string, actor_id: string) {
        return run(async (tx) => {
            const before = await lockPending(tx, id);
            await tx.batchVaccineSchedule.delete({ where: { id } });
            await audit(tx, {
                table: TABLE,
                record_id: id,
                action: "DELETE",
                actor_id,
                note: "Vaccine removed from schedule",
                before: { day: before.day, purpose: before.purpose },
            });
        });
    },

    /** Later or earlier. planned_day is kept so the timeline can show "Day 7 (planned Day 5)". */
    async reschedule(id: string, data: RescheduleVaccineInput, actor_id: string) {
        return run(async (tx) => {
            const before = await lockPending(tx, id);
            const row = await tx.batchVaccineSchedule.update({
                where: { id },
                data: { day: data.day, reason: data.reason },
                include,
            });
            await audit(tx, {
                table: TABLE,
                record_id: id,
                action: "UPDATE",
                actor_id,
                note: `Vaccine rescheduled: day ${before.day} -> ${data.day} (${data.reason})`,
            });
            return row;
        });
    },

    async cancel(id: string, data: CancelVaccineInput, actor_id: string) {
        return run(async (tx) => {
            await lockPending(tx, id);
            const row = await tx.batchVaccineSchedule.update({
                where: { id },
                data: { status: "CANCELLED", reason: data.reason },
                include,
            });
            await audit(tx, {
                table: TABLE,
                record_id: id,
                action: "UPDATE",
                actor_id,
                note: `Vaccine cancelled (${data.reason})`,
            });
            return row;
        });
    },

    /** The worker's one action: every scanned bottle is drawn (the same coded draw as "record use"),
     *  one Vaccinations row per bottle, and the row goes DONE -- all or nothing. */
    async confirm(id: string, data: ConfirmVaccineInput, actor_id: string) {
        return run(async (tx) => {
            const row = await lockRow(tx, id);
            if (row.status === "DONE" && row.confirm_key === data.idempotency_key)
                return tx.batchVaccineSchedule.findUniqueOrThrow({ where: { id }, include });
            if (row.status !== "PENDING")
                throw AppError.conflict(`This vaccine is already ${row.status.toLowerCase()}`);

            const batch = await tx.batches.findUniqueOrThrow({ where: { id: row.batch_id } });
            if (batch.status !== "RUNNING") throw AppError.conflict("This batch isn't running");
            const today = cycleDay(batch.starting_date);
            if (today < row.day)
                throw AppError.conflict(
                    `This vaccine is due on day ${row.day}; today is day ${today}. Ask an admin to reschedule it to give it early.`,
                );

            const purpose = await tx.vaccinePurpose.findUniqueOrThrow({
                where: { code: row.purpose },
            });
            const now = new Date();
            for (const [i, bottle] of data.bottles.entries()) {
                // The row names a purpose, not a product: any QR-coded vaccine bottle will do, and the
                // bottle's own item is what gets drawn and recorded.
                const unit = await tx.stockUnit.findUnique({
                    where: { id: bottle.stock_unit_id },
                    select: {
                        purchase_item: {
                            select: { item: { select: { id: true, name: true, category: true } } },
                        },
                    },
                });
                if (!unit) throw AppError.notFound("StockUnit");
                const item = unit.purchase_item?.item;
                if (!item) throw AppError.badRequest("A bottle isn't linked to a purchase lot yet");
                // ponytail: "VACCINE" is a live ItemCategory.code (renamable in Settings), same caveat as
                // the web's "FEED"/"VACCINE" filters; needs a stable key if renaming it becomes a real risk.
                if (item.category !== "VACCINE")
                    throw AppError.badRequest(`${item.name} isn't a vaccine`);
                const house_id = await unitHouse(tx, bottle.stock_unit_id);
                if (!house_id)
                    throw AppError.conflict(
                        "A bottle is still in the warehouse -- move it to the house first",
                    );
                const occupied = await tx.batchHouseBalance.count({
                    where: { batch_id: row.batch_id, house_id, quantity: { gt: 0 } },
                });
                if (occupied === 0)
                    throw AppError.conflict("A bottle is in a house this batch isn't in");

                const consumption = await drawConsumption(tx, {
                    batch_id: row.batch_id,
                    house_id,
                    item_id: item.id,
                    stock_unit_id: bottle.stock_unit_id,
                    quantity: bottle.quantity,
                    unit: bottle.unit,
                    date: now,
                    note: "Vaccine schedule",
                    recorded_by_id: actor_id,
                    idempotency_key: `${data.idempotency_key}:${i}`,
                });
                await tx.vaccinations.create({
                    data: {
                        batch_id: row.batch_id,
                        consumption_id: consumption.id,
                        schedule_id: id,
                        vaccine_name: item.name,
                        dosage: bottle.quantity,
                        cause: purpose.label,
                        administered_by_id: actor_id,
                        date: now,
                        idempotency_key: `${data.idempotency_key}:${i}`,
                    },
                });
            }

            return tx.batchVaccineSchedule.update({
                where: { id },
                data: {
                    status: "DONE",
                    confirmed_by_id: actor_id,
                    confirmed_at: now,
                    confirm_key: data.idempotency_key,
                },
                include,
            });
        });
    },
};
