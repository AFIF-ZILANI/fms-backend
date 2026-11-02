import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { buildMeta, type PaginationQuery } from "@lib/pagination";
import { farmDay } from "@lib/farm-day";
import type { Prisma } from "../../prisma/generated/prisma/client";

export type ActivityKind =
    | "MORTALITY"
    | "USE"
    | "WEIGHT"
    | "ENVIRONMENT"
    | "BIRDS_IN"
    | "BIRDS_OUT"
    | "STOCK_IN"
    | "STOCK_OUT"
    | "ADJUSTMENT"
    | "VACCINE";

/** One line of a house's history, already worded: the apps only lay it out. */
export type ActivityEntry = {
    id: string;
    kind: ActivityKind;
    /** When it happened. */
    at: Date;
    /** `at` is only a day, not a time: a weighing recorded on a later day than it was taken. */
    day_only?: boolean;
    title: string;
    detail: string | null;
    by: string | null;
    batch_code: string | null;
};

const num = (n: Prisma.Decimal | number) =>
    Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
const unitText = (code: string) => code.toLowerCase().replace(/_/g, " ");
const titleCase = (code: string) => code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, " ");

/**
 * Everything recorded against a house, newest first: deaths, supplies used, weighings, readings, birds and
 * stock moved in or out, stock corrections and vaccine confirms. Treatments show through the stock they
 * drew (a Medication/Vaccination has no house of its own).
 *
 * Paged by merging: each source returns its newest `page * limit` rows, the merge keeps the right slice.
 * ponytail: cost grows with the page number. Fine for scrolling a house's history; switch to an
 * (at, id) cursor if anyone pages hundreds deep.
 */
export async function houseActivity(houseId: string, query: PaginationQuery) {
    const house = await prisma.houses.findUnique({ where: { id: houseId }, select: { id: true } });
    if (!house) throw AppError.notFound("House");

    const take = query.page * query.limit;
    const by = { select: { name: true } } as const;
    const batch = { select: { batch_code: true } } as const;
    const birdsWhere = { OR: [{ to_house_id: houseId }, { from_house_id: houseId }] };
    const transferWhere = {
        OR: [
            { to_location_type: "HOUSE" as const, to_location_id: houseId },
            { from_location_type: "HOUSE" as const, from_location_id: houseId },
        ],
    };

    const [deaths, used, weights, readings, birds, transfers, adjustments, vaccines, counts] =
        await Promise.all([
            prisma.mortalityLog.findMany({
                where: { house_id: houseId },
                orderBy: { date: "desc" },
                take,
                include: { recorded_by: by, batch },
            }),
            prisma.consumption.findMany({
                where: { house_id: houseId },
                orderBy: { date: "desc" },
                take,
                include: { recorded_by: by, batch, item: { select: { name: true } } },
            }),
            prisma.weightRecords.findMany({
                where: { house_id: houseId },
                orderBy: [{ date: "desc" }, { created_at: "desc" }],
                take,
                include: { measured_by: by, batch },
            }),
            prisma.environmentRecords.findMany({
                where: { house_id: houseId },
                orderBy: { recorded_at: "desc" },
                take,
                include: { recorded_by: by, batch },
            }),
            prisma.batchHouseAllocation.findMany({
                where: birdsWhere,
                orderBy: { occurred_at: "desc" },
                take,
                include: {
                    recorded_by: by,
                    batch,
                    from_house: { select: { name: true } },
                    to_house: { select: { name: true } },
                },
            }),
            prisma.stockTransfer.findMany({
                where: transferWhere,
                orderBy: { created_at: "desc" },
                take,
                include: { recorded_by: by, item: { select: { name: true } } },
            }),
            prisma.inventoryAdjustment.findMany({
                where: { house_id: houseId },
                orderBy: { created_at: "desc" },
                take,
                include: { recorded_by: by, item: { select: { name: true, unit: true } } },
            }),
            prisma.batchVaccineHouseConfirm.findMany({
                where: { house_id: houseId },
                orderBy: { confirmed_at: "desc" },
                take,
                include: {
                    confirmed_by: by,
                    schedule: {
                        select: {
                            method: true,
                            day: true,
                            purposeRef: { select: { label: true } },
                            batch,
                        },
                    },
                },
            }),
            Promise.all([
                prisma.mortalityLog.count({ where: { house_id: houseId } }),
                prisma.consumption.count({ where: { house_id: houseId } }),
                prisma.weightRecords.count({ where: { house_id: houseId } }),
                prisma.environmentRecords.count({ where: { house_id: houseId } }),
                prisma.batchHouseAllocation.count({ where: birdsWhere }),
                prisma.stockTransfer.count({ where: transferWhere }),
                prisma.inventoryAdjustment.count({ where: { house_id: houseId } }),
                prisma.batchVaccineHouseConfirm.count({ where: { house_id: houseId } }),
            ]),
        ]);

    // The other end of a stock move, by name.
    const placeIds = transfers.flatMap((t) => [t.from_location_id, t.to_location_id]);
    const [houseNames, warehouseNames] = await Promise.all([
        prisma.houses.findMany({
            where: { id: { in: placeIds } },
            select: { id: true, name: true },
        }),
        prisma.warehouses.findMany({
            where: { id: { in: placeIds } },
            select: { id: true, name: true },
        }),
    ]);
    const names = new Map([...houseNames, ...warehouseNames].map((p) => [p.id, p.name]));
    const place = (type: string, id: string) =>
        type === "DISPOSAL" ? "disposal" : (names.get(id) ?? "another place");

    const entries: ActivityEntry[] = [
        ...deaths.map((m) => ({
            id: m.id,
            kind: "MORTALITY" as const,
            at: m.date,
            title: `${m.count_died.toLocaleString("en-US")} ${m.count_died === 1 ? "bird" : "birds"} died`,
            detail: m.cause_note,
            by: m.recorded_by.name,
            batch_code: m.batch.batch_code,
        })),
        ...used.map((u) => ({
            id: u.id,
            kind: "USE" as const,
            at: u.date,
            title: `Used ${num(u.quantity)} ${unitText(u.unit)} ${u.item.name}`,
            detail: u.note,
            by: u.recorded_by.name,
            batch_code: u.batch?.batch_code ?? null,
        })),
        ...weights.map((w) => {
            // A weighing stores its farm day; the save time is its time only when it was saved that same day.
            const sameDay = farmDay(w.created_at).getTime() === w.date.getTime();
            return {
                id: w.id,
                kind: "WEIGHT" as const,
                at: sameDay ? w.created_at : w.date,
                day_only: !sameDay,
                title: `Weighed ${num(w.average_wt_grams)} g average`,
                detail: `${w.sample_size} birds sampled`,
                by: w.measured_by.name,
                batch_code: w.batch?.batch_code ?? null,
            };
        }),
        ...readings.map((r) => ({
            id: r.id,
            kind: "ENVIRONMENT" as const,
            at: r.recorded_at,
            title: `${num(r.temperature_c)}°C · ${num(r.humidity_percent)}% humidity`,
            detail: `Ammonia ${num(r.ammonia_ppm)} ppm · CO₂ ${num(r.co2_ppm)} ppm`,
            by: r.recorded_by.name,
            batch_code: r.batch.batch_code,
        })),
        ...birds.map((b) => {
            const incoming = b.to_house_id === houseId;
            const n = `${b.quantity.toLocaleString("en-US")} ${b.quantity === 1 ? "bird" : "birds"}`;
            const title = incoming
                ? b.from_house
                    ? `${n} moved in from ${b.from_house.name}`
                    : `${n} placed`
                : b.to_house
                  ? `${n} moved out to ${b.to_house.name}`
                  : `${n} taken out`;
            return {
                id: b.id,
                kind: incoming ? ("BIRDS_IN" as const) : ("BIRDS_OUT" as const),
                at: b.occurred_at,
                title,
                detail: b.reason === "ADJUSTMENT" ? "Correction" : null,
                by: b.recorded_by.name,
                batch_code: b.batch.batch_code,
            };
        }),
        ...transfers.map((t) => {
            const incoming = t.to_location_type === "HOUSE" && t.to_location_id === houseId;
            const what = `${num(t.quantity)} ${unitText(t.unit)} ${t.item.name}`;
            return {
                id: t.id,
                kind: incoming ? ("STOCK_IN" as const) : ("STOCK_OUT" as const),
                at: t.created_at,
                title: incoming
                    ? `Received ${what} from ${place(t.from_location_type, t.from_location_id)}`
                    : `Sent ${what} to ${place(t.to_location_type, t.to_location_id)}`,
                detail: t.note,
                by: t.recorded_by.name,
                batch_code: null,
            };
        }),
        ...adjustments.map((a) => {
            const delta = Number(a.adjustment_quantity);
            return {
                id: a.id,
                kind: "ADJUSTMENT" as const,
                at: a.created_at,
                title: `Stock corrected: ${a.item.name} ${delta > 0 ? "+" : ""}${num(delta)} ${unitText(a.item.unit)}`,
                detail: [titleCase(a.reason), a.note].filter(Boolean).join(" · "),
                by: a.recorded_by.name,
                batch_code: null,
            };
        }),
        ...vaccines.map((v) => ({
            id: v.id,
            kind: "VACCINE" as const,
            at: v.confirmed_at,
            title: `Vaccine given: ${v.schedule.purposeRef.label}`,
            detail: [`Day ${v.schedule.day}`, v.schedule.method && titleCase(v.schedule.method)]
                .filter(Boolean)
                .join(" · "),
            by: v.confirmed_by.name,
            batch_code: v.schedule.batch.batch_code,
        })),
    ];

    entries.sort((a, b) => b.at.getTime() - a.at.getTime() || a.id.localeCompare(b.id));
    const total = counts.reduce((s, n) => s + n, 0);
    return { activity: entries.slice(take - query.limit, take), meta: buildMeta(total, query) };
}
