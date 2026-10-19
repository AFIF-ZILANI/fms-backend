import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { houseNumber } from "@lib/test-fixtures";
import { birdDaysByMonth } from "@lib/bird-days";
import { SharedCostService, splitByWeight } from "./shared-cost.service";
import { BatchPnlService } from "./batch-pnl.service";

// 2009, years before any real or simulated data, so every bird-day and share below is this scenario's alone.
//   A: 100 birds, 1-30 June 2009.   B: 50 birds, 16 June - 15 July 2009, 10 die on 20 June.
//   June bird-days: A 30 x 100 = 3000; B 5 x 50 + 10 x 40 = 650.   July: B 15 x 40 = 600.
const d = (month: number, day: number) => new Date(Date.UTC(2009, month - 1, day));
const ids = { profile: "", house: "", a: "", b: "", expenses: [] as string[], sale: "", death: "" };

describe("bird-days, shared costs and the batch statement", () => {
    beforeAll(async () => {
        ids.profile = (
            await prisma.profiles.create({
                data: {
                    name: "PnL Fixture",
                    mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                    role: "ADMIN",
                },
            })
        ).id;
        ids.house = (
            await prisma.houses.create({
                data: { name: "PnL Fixture House", type: "GROWER", number: houseNumber() },
            })
        ).id;
        const batch = (code: string, start: Date, end: Date, birds: number) =>
            prisma.batches.create({
                data: {
                    batch_code: `${code}-${crypto.randomUUID()}`,
                    breed: "CLASSIC",
                    status: "SOLD",
                    starting_date: start,
                    actual_end_date: end,
                    expected_selling_date: end,
                    initial_chick_count: birds,
                    init_chicks_avg_wt: 40,
                },
            });
        ids.a = (await batch("PNL-A", d(6, 1), d(6, 30), 100)).id;
        ids.b = (await batch("PNL-B", d(6, 16), d(7, 15), 50)).id;
        ids.death = (
            await prisma.mortalityLog.create({
                data: {
                    batch_id: ids.b,
                    house_id: ids.house,
                    count_died: 10,
                    date: d(6, 20),
                    recorded_by_id: ids.profile,
                    idempotency_key: crypto.randomUUID(),
                },
            })
        ).id;
        ids.sale = (
            await prisma.birdSale.create({
                data: {
                    batch_id: ids.b,
                    house_id: ids.house,
                    sale_date: d(7, 15),
                    grade: "HIGH",
                    birds_count: 40,
                    dholta_in_g: 0,
                    total_katha: 4,
                    total_weight: 60,
                    net_weight: 60,
                    price_per_kg: 200,
                    total_amount: 12000,
                    discount_amount: 0,
                    paid_amount: 0,
                    due_amount: 12000,
                    recorded_by_id: ids.profile,
                },
            })
        ).id;
        for (const e of [
            {
                category: "ELECTRICITY",
                cost_type: "SHARED_PERIOD" as const,
                amount: 730,
                date: d(6, 25),
            },
            {
                category: "ELECTRICITY",
                cost_type: "SHARED_PERIOD" as const,
                amount: 300,
                date: d(7, 10),
            },
            { category: "RENT", cost_type: "SHARED_PERIOD" as const, amount: 100, date: d(8, 5) },
            {
                category: "LABOR",
                cost_type: "DIRECT" as const,
                amount: 500,
                date: d(7, 1),
                batch_id: ids.b,
            },
        ])
            ids.expenses.push(
                (await prisma.expense.create({ data: { ...e, recorded_by_id: ids.profile } })).id,
            );
    });

    afterAll(async () => {
        await prisma.expense.deleteMany({ where: { id: { in: ids.expenses } } });
        await prisma.birdSale.deleteMany({ where: { id: ids.sale } });
        await prisma.mortalityLog.deleteMany({ where: { id: ids.death } });
        await prisma.batches.deleteMany({ where: { id: { in: [ids.a, ids.b] } } });
        await prisma.houses.deleteMany({ where: { id: ids.house } });
        await prisma.profiles.deleteMany({ where: { id: ids.profile } });
    });

    test("bird-days count live birds at the start of each day, a death from the next day", async () => {
        const bd = await birdDaysByMonth();
        expect(bd.get("2009-06")?.get(ids.a)).toBe(3000);
        expect(bd.get("2009-06")?.get(ids.b)).toBe(650);
        expect(bd.get("2009-07")?.get(ids.b)).toBe(600);
        expect(bd.get("2009-07")?.has(ids.a)).toBe(false);
    });

    test("shared costs split by bird-days; a month with no birds stays farm overhead", async () => {
        const months = await SharedCostService.byMonth();
        const june = months.find((m) => m.month === "2009-06")!;
        expect(june.batches.find((b) => b.batch_id === ids.a)?.share).toBe(600);
        expect(june.batches.find((b) => b.batch_id === ids.b)?.share).toBe(130);
        expect([june.total, june.allocated, june.overhead]).toEqual([730, 730, 0]);
        expect(months.find((m) => m.month === "2009-07")!.batches).toEqual([
            expect.objectContaining({ batch_id: ids.b, share: 300 }),
        ]);
        const aug = months.find((m) => m.month === "2009-08")!;
        expect([aug.allocated, aug.overhead]).toEqual([0, 100]);
    });

    test("splitByWeight hands the rounding remainder to the largest share so parts add up exactly", () => {
        const parts = splitByWeight(
            100,
            new Map([
                ["x", 1],
                ["y", 1],
                ["z", 1],
            ]),
        );
        expect([...parts.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(100, 10);
        expect(splitByWeight(50, new Map()).size).toBe(0);
    });

    test("the statement adds up: revenue - costs = contribution; minus shared = net profit", async () => {
        const st = await BatchPnlService.statement(ids.b);
        expect(st.revenue.net).toBe(12000);
        expect(st.cost_lines).toEqual([{ section: "DIRECT", label: "Labor", amount: 500 }]);
        expect(st.contribution).toBe(11500);
        expect(st.shared_costs.total).toBe(430); // 130 June + 300 July
        expect(st.net_profit).toBe(11070);
        expect(st.birds).toMatchObject({ placed: 50, died: 10, sold: 40 });
        expect(st.per_unit.profit_per_bird).toBe(276.75); // 11070 / 40
        expect(st.per_unit.avg_price_per_kg).toBe(200);
        expect(st.money).toEqual({ received: 0, due: 12000 });
    });
});
