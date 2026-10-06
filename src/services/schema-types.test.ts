import { describe, test, expect, afterAll } from "bun:test";
import prisma from "@lib/db";
import { HouseService } from "./house.service";
import { houseNumber } from "@lib/test-fixtures";

// Column types and keys that say what the data is, so the database can hold the line.

const houseIds: string[] = [];
const itemIds: string[] = [];
const alertIds: string[] = [];

/** Prisma's lazy query isn't a real promise, which `expect(...).rejects` needs. */
const refused = (fn: () => PromiseLike<unknown>) => expect((async () => fn())()).rejects.toThrow();

describe("column types and keys", () => {
    afterAll(async () => {
        await prisma.stockLedger.deleteMany({ where: { item_id: { in: itemIds } } });
        await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
        await prisma.alerts.deleteMany({ where: { id: { in: alertIds } } });
        await prisma.houses.deleteMany({ where: { id: { in: houseIds } } });
    });

    test("a house number is unique within a type, but may repeat across types", async () => {
        const n = houseNumber();
        const brooder = await HouseService.create({ name: "Dup Brooder", type: "BROODER", number: n });
        houseIds.push(brooder.id);

        // Brooder 1 and Grower 1 are different sheds on this farm...
        const grower = await HouseService.create({ name: "Same number, other type", type: "GROWER", number: n });
        houseIds.push(grower.id);

        // ...but two Brooder Ns are not, whether created or renumbered into.
        await expect(HouseService.create({ name: "Dup again", type: "BROODER", number: n })).rejects.toMatchObject({ status: 409 });
        const other = await HouseService.create({ name: "Other", type: "BROODER", number: houseNumber() });
        houseIds.push(other.id);
        await expect(HouseService.update(other.id, { number: n })).rejects.toMatchObject({ status: 409 });
        // Changing the type into a free slot is fine.
        await HouseService.update(other.id, { type: "LAYER" });
    });

    test("the ingest columns are real enums", async () => {
        const rows = await prisma.$queryRaw<{ typname: string; labels: string[] }[]>`
            SELECT t.typname::text AS typname, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
            FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
            WHERE t.typname IN ('IngestStatus', 'IngestPortion') GROUP BY t.typname ORDER BY t.typname`;
        expect(rows).toEqual([
            { typname: "IngestPortion", labels: ["main", "cull"] },
            { typname: "IngestStatus", labels: ["PENDING", "CONFIRMED", "DISMISSED"] },
        ]);
        // A value outside the enum can't be stored, even by hand.
        await refused(() => prisma.$executeRaw`UPDATE "IngestedSale" SET status = 'BOGUS'::"IngestStatus" WHERE false`);
    });

    test("a purchase has to name its warehouse", async () => {
        const profile = await prisma.profiles.findFirstOrThrow({ where: { role: "ADMIN" }, select: { id: true } });
        await refused(() =>
            prisma.purchase.create({
                data: { purchase_date: new Date(), total_amount: 1, paid_amount: 1, due_amount: 0, recorded_by_id: profile.id } as never,
            }),
        );
    });

    test("a per-unit cost keeps its fractions of a taka", async () => {
        const item = await prisma.item.create({
            data: { name: `Cost Item ${crypto.randomUUID()}`, normalized_key: `cost item ${crypto.randomUUID()}`, category: "MEDICINE", unit: "G" },
        });
        itemIds.push(item.id);
        const row = await prisma.stockLedger.create({
            data: {
                item_id: item.id,
                quantity: 1,
                direction: "IN",
                reason: "PURCHASE",
                ref_type: "PURCHASE",
                ref_id: crypto.randomUUID(),
                idempotency_key: crypto.randomUUID(),
                unit_cost: "0.0125", // a gram of a bulk medicine; Decimal(10,2) stored this as 0.01
            },
        });
        expect((await prisma.stockLedger.findUniqueOrThrow({ where: { id: row.id } })).unit_cost?.toString()).toBe("0.0125");
    });

    test("an alert keeps the time it was issued and resolved, not just the date", async () => {
        const issued = new Date("2027-02-03T10:20:30.123Z");
        const resolved = new Date("2027-02-03T18:45:00.500Z");
        const alert = await prisma.alerts.create({
            data: {
                title: "time keeping",
                type: "SYSTEM",
                level: "INFO",
                issued_at: issued,
                resolved_at: resolved,
                idempotency_key: crypto.randomUUID(),
            },
        });
        alertIds.push(alert.id);
        const back = await prisma.alerts.findUniqueOrThrow({ where: { id: alert.id } });
        expect(back.issued_at?.toISOString()).toBe(issued.toISOString());
        expect(back.resolved_at?.toISOString()).toBe(resolved.toISOString());
    });
});
