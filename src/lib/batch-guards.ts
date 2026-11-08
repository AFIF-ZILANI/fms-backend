import type { Prisma } from "../../prisma/generated/prisma/client";
import { AppError } from "@lib/app-error";
import { farmDay } from "@lib/farm-day";

/**
 * A CLOSED batch is final: its books are settled, so no new or changed cost/income may be tagged to it.
 * RUNNING and SOLD both pass -- SOLD is the settlement window, where late litter sales, missed bottles
 * and late bills still land (docs/superpowers/specs/2026-11-08-batch-settlement-and-stock-count-design.md).
 * A missing id keeps the existing foreign-key handling.
 */
export async function assertBatchOpen(tx: Prisma.TransactionClient, batch_id: string) {
    const batch = await tx.batches.findUnique({
        where: { id: batch_id },
        select: { status: true, batch_code: true },
    });
    if (batch?.status === "CLOSED")
        throw AppError.conflict(`Batch ${batch.batch_code} is finalised`);
}

/**
 * The batch that occupied a house on a farm day: its birds arrived in the house on or before that day,
 * it was placed by then, and it hadn't ended before it. Latest arrival wins.
 *
 * ponytail: ignores a batch that moved out of the house before its end (it still matches for that
 * house until it ends). Replay BatchHouseAllocation in/out per day if that ever bites.
 */
export async function batchInHouseOn(tx: Prisma.TransactionClient, house_id: string, day: Date) {
    const d = farmDay(day);
    const rows = await tx.batchHouseAllocation.findMany({
        where: { to_house_id: house_id },
        orderBy: { occurred_at: "desc" },
        select: {
            occurred_at: true,
            batch: {
                select: {
                    id: true,
                    batch_code: true,
                    status: true,
                    starting_date: true,
                    actual_end_date: true,
                },
            },
        },
    });
    for (const { occurred_at, batch } of rows) {
        if (farmDay(occurred_at) > d || farmDay(batch.starting_date) > d) continue;
        if (batch.actual_end_date && farmDay(batch.actual_end_date) < d) continue;
        return { id: batch.id, batch_code: batch.batch_code, status: batch.status };
    }
    return null;
}

/** batch_id for a consumption: the one given, else whoever was in the house that day; refused if final. */
export async function batchForUsage(
    tx: Prisma.TransactionClient,
    house_id: string,
    date: Date,
    batch_id: string | undefined,
): Promise<string | undefined> {
    const id = batch_id ?? (await batchInHouseOn(tx, house_id, date))?.id;
    if (id !== undefined) await assertBatchOpen(tx, id);
    return id;
}
