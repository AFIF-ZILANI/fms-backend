import prisma from "@lib/db";

const DAY = 86_400_000;
const dayOf = (d: Date) => Math.floor(d.getTime() / DAY); // UTC day number
const monthOfDay = (day: number) => new Date(day * DAY).toISOString().slice(0, 7);

/**
 * Bird-days per batch per calendar month: for every day a batch was running, the birds alive at the start of
 * that day, summed by month. A batch of 5,000 for a whole month weighs more than 3,000 for half of it -- the
 * basis for sharing farm-wide costs (electricity, rent...) between the batches that were there.
 *
 * Live birds are rebuilt from the batch's own events, not from the cached house balances: placed on the
 * starting date, minus deaths and sales on their dates, plus/minus ADJUSTMENT moves (a force-close takes the
 * remainder off). A batch stops counting when it closes or reaches zero; a running one counts up to today.
 *
 * ponytail: one pass per batch over its whole life (~60-70 days). Fine for a farm's dozens of batches.
 */
export async function birdDaysByMonth(): Promise<Map<string, Map<string, number>>> {
    const [batches, deaths, sales, adjustments] = await Promise.all([
        prisma.batches.findMany({
            select: {
                id: true,
                starting_date: true,
                actual_end_date: true,
                initial_chick_count: true,
            },
        }),
        prisma.mortalityLog.findMany({ select: { batch_id: true, date: true, count_died: true } }),
        prisma.birdSale.findMany({
            select: { batch_id: true, sale_date: true, birds_count: true },
        }),
        prisma.batchHouseAllocation.findMany({
            where: { reason: "ADJUSTMENT" },
            select: {
                batch_id: true,
                occurred_at: true,
                quantity: true,
                from_house_id: true,
                to_house_id: true,
            },
        }),
    ]);

    // change in live birds per batch per day
    const deltas = new Map<string, Map<number, number>>();
    const bump = (batch: string, at: Date, by: number) => {
        const m = deltas.get(batch) ?? new Map<number, number>();
        m.set(dayOf(at), (m.get(dayOf(at)) ?? 0) + by);
        deltas.set(batch, m);
    };
    for (const d of deaths) bump(d.batch_id, d.date, -d.count_died);
    for (const s of sales) bump(s.batch_id, s.sale_date, -s.birds_count);
    for (const a of adjustments) {
        if (a.from_house_id && !a.to_house_id) bump(a.batch_id, a.occurred_at, -a.quantity);
        if (a.to_house_id && !a.from_house_id) bump(a.batch_id, a.occurred_at, a.quantity);
    }

    const today = dayOf(new Date());
    const out = new Map<string, Map<string, number>>();
    for (const b of batches) {
        const start = dayOf(b.starting_date);
        const end = b.actual_end_date ? dayOf(b.actual_end_date) : today;
        const changes = deltas.get(b.id) ?? new Map<number, number>();
        let live = b.initial_chick_count;
        for (let day = start; day <= end; day++) {
            if (live > 0) {
                const month = monthOfDay(day);
                const m = out.get(month) ?? new Map<string, number>();
                m.set(b.id, (m.get(b.id) ?? 0) + live);
                out.set(month, m);
            }
            live += changes.get(day) ?? 0; // today's events count from tomorrow
        }
    }
    return out;
}
