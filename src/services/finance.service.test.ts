import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { FinanceService } from "./finance.service";
import { houseNumber, sharedInstrumentId, sharedWarehouseId } from "@lib/test-fixtures";

// Everything is dated March 2010 (with one February purchase), years before any real or simulated data, so
// the period figures are exactly this scenario's.
const d = (day: number, month = 2) => new Date(Date.UTC(2010, month, day));
const ids = {
    profile: "",
    house: "",
    batch: "",
    feed: "",
    chick: "",
    purchases: [] as string[],
    sales: [] as string[],
    birdSale: "",
    expenses: [] as string[],
    consumption: "",
    payments: [] as string[],
};

describe("FinanceService", () => {
    beforeAll(async () => {
        const profile = await prisma.profiles.create({
            data: {
                name: "Finance Fixture",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "ADMIN",
            },
        });
        ids.profile = profile.id;
        const house = await prisma.houses.create({
            data: { name: "Finance Fixture House", type: "GROWER", number: houseNumber() },
        });
        ids.house = house.id;
        const batch = await prisma.batches.create({
            data: {
                batch_code: `FIN-${crypto.randomUUID()}`,
                breed: "CLASSIC",
                starting_date: d(1),
                expected_selling_date: d(30),
                initial_chick_count: 10,
                init_chicks_avg_wt: 40,
            },
        });
        ids.batch = batch.id;
        const [feed, chick] = await Promise.all([
            prisma.item.create({
                data: {
                    name: `Fin Feed ${crypto.randomUUID()}`,
                    normalized_key: `fin feed ${crypto.randomUUID()}`,
                    category: "FEED",
                    unit: "KG",
                },
            }),
            prisma.item.create({
                data: {
                    name: `Fin Chick ${crypto.randomUUID()}`,
                    normalized_key: `fin chick ${crypto.randomUUID()}`,
                    category: "CHICKS",
                    unit: "PCS",
                },
            }),
        ]);
        ids.feed = feed.id;
        ids.chick = chick.id;
        const warehouse_id = await sharedWarehouseId();
        const account = await sharedInstrumentId();

        // Feed bought in February (not a March cost); chicks bought onto the batch in March (a March cost).
        const feedBuy = await prisma.purchase.create({
            data: {
                warehouse_id,
                purchase_date: d(20, 1),
                total_amount: 1000,
                paid_amount: 0,
                due_amount: 1000,
                recorded_by_id: profile.id,
                items: {
                    create: {
                        item_id: feed.id,
                        quantity: 100,
                        unit: "KG",
                        base_quantity: 100,
                        unit_price: 10,
                        total_price: 1000,
                    },
                },
            },
        });
        const chickBuy = await prisma.purchase.create({
            data: {
                warehouse_id,
                purchase_date: d(2),
                total_amount: 400,
                paid_amount: 0,
                due_amount: 400,
                recorded_by_id: profile.id,
                items: {
                    create: {
                        item_id: chick.id,
                        batch_id: batch.id,
                        quantity: 10,
                        unit: "PCS",
                        base_quantity: 10,
                        unit_price: 40,
                        total_price: 400,
                    },
                },
            },
        });
        ids.purchases.push(feedBuy.id, chickBuy.id);
        // 30 kg of feed used in March, at the average cost of 10/kg.
        ids.consumption = (
            await prisma.consumption.create({
                data: {
                    batch_id: batch.id,
                    house_id: house.id,
                    item_id: feed.id,
                    quantity: 30,
                    unit: "KG",
                    base_quantity: 30,
                    date: d(15),
                    recorded_by_id: profile.id,
                    idempotency_key: crypto.randomUUID(),
                },
            })
        ).id;
        const sale = await prisma.sale.create({
            data: {
                sale_date: d(10),
                total: 1000,
                paid_amount: 0,
                due_amount: 1000,
                recorded_by_id: profile.id,
            },
        });
        ids.sales.push(sale.id);
        ids.birdSale = (
            await prisma.birdSale.create({
                data: {
                    batch_id: batch.id,
                    sale_date: d(25),
                    grade: "HIGH",
                    birds_count: 8,
                    dholta_in_g: 0,
                    total_katha: 1,
                    total_weight: 10,
                    net_weight: 10,
                    price_per_kg: 200,
                    total_amount: 2000,
                    discount_amount: 100,
                    paid_amount: 0,
                    due_amount: 1900,
                    recorded_by_id: profile.id,
                },
            })
        ).id;
        const labour = await prisma.expense.create({
            data: {
                category: "LABOR",
                cost_type: "SHARED_PERIOD",
                amount: 300,
                date: d(5),
                recorded_by_id: profile.id,
            },
        });
        const salary = await prisma.expense.create({
            data: {
                category: "SALARY",
                cost_type: "SHARED_PERIOD",
                amount: 200,
                date: d(28),
                recorded_by_id: profile.id,
            },
        });
        ids.expenses.push(labour.id, salary.id);
        for (const p of [
            {
                amount: 500,
                direction: "INCOMING" as const,
                ref_type: "SALE" as const,
                ref_id: sale.id,
                to_instrument_id: account,
                payment_date: d(12),
            },
            {
                amount: 300,
                direction: "OUTGOING" as const,
                ref_type: "EXPENSE" as const,
                ref_id: labour.id,
                from_instrument_id: account,
                payment_date: d(5),
            },
        ])
            ids.payments.push((await prisma.payment.create({ data: p })).id);
    });

    afterAll(async () => {
        await prisma.payment.deleteMany({ where: { id: { in: ids.payments } } });
        await prisma.expense.deleteMany({ where: { id: { in: ids.expenses } } });
        await prisma.birdSale.deleteMany({ where: { id: ids.birdSale } });
        await prisma.sale.deleteMany({ where: { id: { in: ids.sales } } });
        await prisma.consumption.deleteMany({ where: { id: ids.consumption } });
        await prisma.purchaseItem.deleteMany({ where: { purchase_id: { in: ids.purchases } } });
        await prisma.purchase.deleteMany({ where: { id: { in: ids.purchases } } });
        await prisma.item.deleteMany({ where: { id: { in: [ids.feed, ids.chick] } } });
        await prisma.batches.deleteMany({ where: { id: ids.batch } });
        await prisma.houses.deleteMany({ where: { id: ids.house } });
        await prisma.profiles.deleteMany({ where: { id: ids.profile } });
    });

    test("March: revenue net of discount, costs counted when used, balances at month end", async () => {
        const { current: m, previous: feb } = await FinanceService.summary({
            from: d(1),
            to: d(1, 3),
        });
        expect(m.revenue).toBe(1900 + 1000);
        // chicks 400 + feed used 30 x 10 + labour 300 + salary 200 -- the February feed purchase is not a cost
        expect(m.costs).toBe(1200);
        expect(m.net_profit).toBe(1700);
        expect(m.margin).toBeCloseTo(1700 / 2900, 4);
        const line = (code: string) => m.cost_breakdown.find((c) => c.code === code)?.amount;
        expect([line("CHICKS"), line("FEED"), line("LABOR"), line("SALARY")]).toEqual([
            400, 300, 300, 200,
        ]);
        expect(m.cash).toBe(500 - 300);
        expect(m.receivables).toBe(1900 + 1000 - 500);
        // chicks 400 + feed 1000 still unpaid; labour paid; salary is payroll's, never owed as an expense
        expect(m.payables).toBe(1400);
        // the same-length period before: no revenue or costs, but the February feed bill was already owed
        expect([feb.revenue, feb.costs, feb.cash, feb.receivables, feb.payables]).toEqual([
            0, 0, 0, 0, 1000,
        ]);
    });

    test("an explicit comparison period is used as given", async () => {
        const { previous } = await FinanceService.summary({
            from: d(1),
            to: d(1, 3),
            compare_from: d(1, 1),
            compare_to: d(1, 2),
        });
        expect(previous.from.toISOString().slice(0, 10)).toBe("2010-02-01");
    });

    test("monthly returns the requested months, oldest first, ending this month", async () => {
        const rows = await FinanceService.monthly(6);
        expect(rows).toHaveLength(6);
        expect(rows.at(-1)!.month).toBe(new Date().toISOString().slice(0, 7));
        expect(rows.map((r) => r.month)).toEqual([...rows.map((r) => r.month)].sort());
        for (const r of rows) expect(r.profit).toBeCloseTo(r.revenue - r.costs, 2);
    });

    test("owed: totals equal the buckets, and the top lists are sorted largest first", async () => {
        const { receivables, payables } = await FinanceService.owed(5);
        for (const side of [receivables, payables]) {
            expect(side.total).toBeCloseTo(
                side.buckets.d0_30 + side.buckets.d31_60 + side.buckets.d60_plus,
                2,
            );
            expect(side.top.map((t) => t.due)).toEqual(
                [...side.top.map((t) => t.due)].sort((a, b) => b - a),
            );
        }
        // this scenario's walk-in sales are over 60 days old
        expect(receivables.buckets.d60_plus).toBeGreaterThanOrEqual(2400);
    });
});
