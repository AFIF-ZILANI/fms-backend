import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { Prisma } from "../../prisma/generated/prisma/client";
import { AnalyticsService } from "./analytics.service";
import { PaymentService } from "./payment.service";
import { SaleService } from "./sale.service";
import { BirdSaleService } from "./bird-sale.service";
import { sharedWarehouseId } from "@lib/test-fixtures";

// The dashboard and summary figures, checked against plain aggregates and against what payments change.

const mobile = () => `+880${Math.floor(1e9 + Math.random() * 8e9)}`;
let actorId: string;
let instrumentId: string;
const saleIds: string[] = [];
const purchaseIds: string[] = [];
const expenseIds: string[] = [];
const CATEGORY = `DASH_TEST_${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
const D = (v: Prisma.Decimal | string | number) => new Prisma.Decimal(v);

describe("dashboard and summary queries", () => {
    beforeAll(async () => {
        const actor = await prisma.profiles.create({
            data: { name: "Dash Actor", mobile: mobile(), role: "ADMIN" },
        });
        actorId = actor.id;
        const instrument = await prisma.paymentInstrument.create({
            data: {
                owner_type: "ADMIN",
                owner_id: actorId,
                type: "MFS",
                label: "Dash wallet",
                mfs_type: "BKASH",
                mobile_no: mobile(),
            },
        });
        instrumentId = instrument.id;
        await prisma.expenseCategoryLookup.create({ data: { code: CATEGORY, label: CATEGORY } });
    });

    afterAll(async () => {
        await prisma.payment.deleteMany({ where: { from_instrument_id: instrumentId } });
        await prisma.paymentInstrument.deleteMany({ where: { id: instrumentId } });
        await prisma.expense.deleteMany({ where: { id: { in: expenseIds } } });
        await prisma.expenseCategoryLookup.deleteMany({ where: { code: CATEGORY } });
        await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
        await prisma.purchase.deleteMany({ where: { id: { in: purchaseIds } } });
        await prisma.profiles.deleteMany({ where: { id: actorId } });
    });

    test("outstanding payables and receivables drop by what has been paid", async () => {
        const longAgo = new Date(Date.now() - 400 * 86_400_000);
        const sale = await prisma.sale.create({
            data: { sale_date: longAgo, total: 200, paid_amount: 0, due_amount: 200, recorded_by_id: actorId },
        });
        saleIds.push(sale.id);
        const purchase = await prisma.purchase.create({
            data: { warehouse_id: await sharedWarehouseId(), purchase_date: longAgo, total_amount: 300, paid_amount: 0, due_amount: 300, recorded_by_id: actorId },
        });
        purchaseIds.push(purchase.id);

        const before = await AnalyticsService.financialDashboard({});
        await PaymentService.create({
            amount: 50,
            payment_date: new Date(),
            ref_type: "SALE",
            ref_id: sale.id,
            from_instrument_id: instrumentId,
        });
        await PaymentService.create({
            amount: 70,
            payment_date: new Date(),
            ref_type: "PURCHASE",
            ref_id: purchase.id,
            from_instrument_id: instrumentId,
        });
        const after = await AnalyticsService.financialDashboard({});

        // Previously these read the create-time snapshot and never moved.
        expect(D(before.outstanding_receivables).minus(after.outstanding_receivables).toString()).toBe("50");
        expect(D(before.outstanding_payables).minus(after.outstanding_payables).toString()).toBe("70");
    });

    test("revenueVsExpenses buckets by month exactly as per-month aggregates would", async () => {
        const now = new Date();
        const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
        const inMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 2, 12));
        const sale = await prisma.sale.create({
            data: { sale_date: inMonth, total: 123, paid_amount: 0, due_amount: 123, recorded_by_id: actorId },
        });
        saleIds.push(sale.id);
        const expense = await prisma.expense.create({
            data: { category: CATEGORY, cost_type: "SHARED_PERIOD", amount: 45, date: inMonth, recorded_by_id: actorId },
        });
        expenseIds.push(expense.id);

        const [row] = (await AnalyticsService.revenueVsExpenses(3)).filter(
            (r) => r.month === monthStart.toISOString().slice(0, 7),
        );
        const [s, b, e] = await Promise.all([
            prisma.sale.aggregate({ where: { sale_date: { gte: monthStart, lt: monthEnd } }, _sum: { total: true } }),
            prisma.birdSale.aggregate({ where: { sale_date: { gte: monthStart, lt: monthEnd } }, _sum: { total_amount: true } }),
            prisma.expense.aggregate({ where: { date: { gte: monthStart, lt: monthEnd } }, _sum: { amount: true } }),
        ]);
        expect(row!.revenue).toBe(D(s._sum.total ?? 0).plus(b._sum.total_amount ?? 0).toString());
        expect(row!.expenses).toBe(D(e._sum.amount ?? 0).toString());
        // And the rows span exactly the requested window, oldest first.
        expect((await AnalyticsService.revenueVsExpenses(3)).map((r) => r.month)).toHaveLength(3);
    });

    test("houses occupied counts only houses holding birds", async () => {
        const overview = await AnalyticsService.farmOverview();
        const houses = await prisma.houses.findMany({
            where: { is_active: true },
            include: { batchHouseBalances: true },
        });
        const occupied = houses.filter((h) => h.batchHouseBalances.some((x) => x.quantity > 0)).length;
        expect(overview.houses_occupied).toBe(occupied);
        expect(overview.houses_empty).toBe(houses.length - occupied);
    });

    test("the unfiltered sales summaries net every payment, as the filtered ones do per id", async () => {
        const longAgo = new Date(Date.now() - 400 * 86_400_000);
        const sale = await prisma.sale.create({
            data: { sale_date: longAgo, total: 90, paid_amount: 0, due_amount: 90, recorded_by_id: actorId },
        });
        saleIds.push(sale.id);
        await PaymentService.create({
            amount: 30,
            payment_date: new Date(),
            ref_type: "SALE",
            ref_id: sale.id,
            from_instrument_id: instrumentId,
        });

        const all = await SaleService.summary({} as never);
        const dueSum = await prisma.sale.aggregate({ _sum: { due_amount: true } });
        const paidSum = await prisma.payment.aggregate({ where: { ref_type: "SALE" }, _sum: { amount: true } });
        expect(all.total_due).toBe(D(dueSum._sum.due_amount ?? 0).minus(paidSum._sum.amount ?? 0).toString());

        // The bird-sale summary takes the same shortcut.
        const birds = await BirdSaleService.summary({} as never);
        const bDue = await prisma.birdSale.aggregate({ _sum: { due_amount: true } });
        const bPaid = await prisma.payment.aggregate({ where: { ref_type: "BIRD_SALE" }, _sum: { amount: true } });
        expect(birds.total_due).toBe(D(bDue._sum.due_amount ?? 0).minus(bPaid._sum.amount ?? 0).toString());
    });
});
