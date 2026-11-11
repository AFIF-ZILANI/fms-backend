import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { SaleService } from "./sale.service";
import { AppError } from "@lib/app-error";
import {
    sharedInstrumentId,
    sharedWarehouseId,
    seedStock,
    purgeAuditLog,
} from "@lib/test-fixtures";
import { PaymentService } from "./payment.service";
import { getItemLocationBalance } from "@lib/stock-balance";
import { SaleScanService } from "./sale-scan.service";
import { createLookupService } from "@lib/lookup-factory";
import { createSaleSchema } from "@validators/sale.validator";

let itemId: string;
let warehouseId: string;
let profileId: string;
const createdSaleIds: string[] = [];
const createdItemIds: string[] = [];

describe("SaleService", () => {
    beforeAll(async () => {
        const item = await prisma.item.create({
            data: {
                name: `Sale Item ${crypto.randomUUID()}`,
                normalized_key: `sale item ${crypto.randomUUID()}`,
                category: "OTHER",
                unit: "BAG",
            },
        });
        itemId = item.id;
        warehouseId = await sharedWarehouseId();
        await seedStock(itemId, warehouseId, 1000);
        const profile = await prisma.profiles.create({
            data: {
                name: "Sale Recorder",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "ADMIN",
            },
        });
        profileId = profile.id;
    });

    afterAll(async () => {
        await prisma.saleItem.deleteMany({ where: { sale_id: { in: createdSaleIds } } });
        await prisma.payment.deleteMany({ where: { ref_id: { in: createdSaleIds } } });
        await prisma.sale.deleteMany({ where: { id: { in: createdSaleIds } } });
        await prisma.stockLedger.deleteMany({ where: { item_id: { in: createdItemIds } } });
        await prisma.item.deleteMany({ where: { id: { in: createdItemIds } } });
        await prisma.stockLedger.deleteMany({ where: { item_id: itemId } });
        await prisma.item.delete({ where: { id: itemId } });
        await purgeAuditLog({ where: { changed_by_id: profileId } });
        await prisma.profiles.delete({ where: { id: profileId } });
    });

    test("create computes line totals and sale total with exact decimal math", async () => {
        const sale = await SaleService.create({
            kind: "STOCK",
            sale_date: new Date(),
            warehouse_id: warehouseId,
            paid_amount: 50,
            paid_to_instrument_id: await sharedInstrumentId(),
            recorded_by_id: profileId,
            items: [
                { item_id: itemId, quantity: 4, unit: "BAG", unit_price: 12.25 },
                { item_id: itemId, quantity: 2, unit: "BAG", unit_price: 8.5 },
            ],
        });
        createdSaleIds.push(sale!.id);

        // 4 * 12.25 = 49.00, 2 * 8.50 = 17.00, total = 66.00
        expect(sale!.total.toNumber()).toBeCloseTo(66.0, 2);
        // Stored as "nothing paid yet": the 50 paid at the till is a Payment into the account, so the cash
        // position sees it, and what is still owed is the stored due minus that payment.
        expect(sale!.paid_amount.toNumber()).toBe(0);
        expect(sale!.due_amount.toNumber()).toBeCloseTo(66.0, 2);
        const payments = await prisma.payment.findMany({
            where: { ref_type: "SALE", ref_id: sale!.id },
        });
        expect(payments).toHaveLength(1);
        expect(payments[0]).toMatchObject({ direction: "INCOMING", from_instrument_id: null });
        expect(payments[0]!.amount.toNumber()).toBe(50);
        expect(payments[0]!.to_instrument_id).toBeTruthy();
        expect((await PaymentService.outstandingForRef("SALE", sale!.id)).toNumber()).toBeCloseTo(
            16.0,
            2,
        );
    });

    test("paid_amount exceeding total throws bad-request", async () => {
        await expect(
            SaleService.create({
                kind: "STOCK",
                sale_date: new Date(),
                warehouse_id: warehouseId,
                paid_amount: 9999,
                recorded_by_id: profileId,
                items: [{ item_id: itemId, quantity: 1, unit: "BAG", unit_price: 5 }],
            }),
        ).rejects.toMatchObject({ status: 400 });
    });

    test("getById on unknown id throws not-found", async () => {
        await expect(
            SaleService.getById("00000000-0000-0000-0000-000000000000"),
        ).rejects.toBeInstanceOf(AppError);
    });

    test("getAll filters by date_from/date_to and item_category", async () => {
        const medicineItem = await prisma.item.create({
            data: {
                name: `Filter Medicine ${crypto.randomUUID()}`,
                normalized_key: `filter-medicine-${crypto.randomUUID()}`,
                category: "MEDICINE",
                unit: "BOTTLE",
            },
        });
        createdItemIds.push(medicineItem.id);
        await seedStock(medicineItem.id, warehouseId, 10);

        const recentSale = await SaleService.create({
            kind: "STOCK",
            sale_date: new Date(),
            warehouse_id: warehouseId,
            paid_amount: 0,
            recorded_by_id: profileId,
            items: [{ item_id: medicineItem.id, quantity: 1, unit: "BOTTLE", unit_price: 20 }],
        });
        createdSaleIds.push(recentSale!.id);

        const oldSale = await SaleService.create({
            kind: "STOCK",
            warehouse_id: warehouseId,
            sale_date: new Date(Date.now() - 10 * 86_400_000),
            paid_amount: 0,
            recorded_by_id: profileId,
            items: [{ item_id: itemId, quantity: 1, unit: "BAG", unit_price: 5 }],
        });
        createdSaleIds.push(oldSale!.id);

        const { sales: dateFiltered } = await SaleService.getAll({
            page: 1,
            limit: 100,
            date_from: new Date(Date.now() - 86_400_000),
        });
        expect(dateFiltered.some((s) => s.id === recentSale!.id)).toBe(true);
        expect(dateFiltered.some((s) => s.id === oldSale!.id)).toBe(false);

        const { sales: categoryFiltered } = await SaleService.getAll({
            page: 1,
            limit: 100,
            item_category: "MEDICINE",
        });
        expect(categoryFiltered.some((s) => s.id === recentSale!.id)).toBe(true);
        expect(categoryFiltered.some((s) => s.id === oldSale!.id)).toBe(false);
    });
    test("summary totals move by exactly the sale just created", async () => {
        const before = await SaleService.summary({});

        const sale = await SaleService.create({
            kind: "STOCK",
            sale_date: new Date(),
            warehouse_id: warehouseId,
            paid_amount: 20,
            paid_to_instrument_id: await sharedInstrumentId(),
            recorded_by_id: profileId,
            items: [{ item_id: itemId, quantity: 2, unit: "BAG", unit_price: 50 }],
        });
        createdSaleIds.push(sale!.id);

        const after = await SaleService.summary({});
        expect(after.count - before.count).toBe(1);
        expect(parseFloat(after.total_revenue) - parseFloat(before.total_revenue)).toBeCloseTo(
            100,
            2,
        );
        expect(parseFloat(after.total_due) - parseFloat(before.total_due)).toBeCloseTo(80, 2);
    });
});

describe("SaleService stock", () => {
    let wh: string;
    let item: string;
    let actor: string;
    const saleIds: string[] = [];
    const sell = (quantity: number, over: Record<string, unknown> = {}) =>
        SaleService.create({
            kind: "STOCK",
            sale_date: new Date(),
            warehouse_id: wh,
            paid_amount: 0,
            recorded_by_id: actor,
            items: [{ item_id: item, quantity, unit: "BAG", unit_price: 10 }],
            ...over,
        } as never);
    const onHand = () =>
        prisma
            .$transaction((tx) => getItemLocationBalance(tx, item, "WAREHOUSE", wh))
            .then((d) => d.toNumber());

    beforeAll(async () => {
        wh = await sharedWarehouseId();
        item = (
            await prisma.item.create({
                data: {
                    name: `Stock Sale ${crypto.randomUUID()}`,
                    normalized_key: `stock sale ${crypto.randomUUID()}`,
                    category: "OTHER",
                    unit: "BAG",
                },
            })
        ).id;
        actor = (
            await prisma.profiles.create({
                data: {
                    name: "Stock Sale Actor",
                    mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                    role: "ADMIN",
                },
            })
        ).id;
        await seedStock(item, wh, 10);
    });

    afterAll(async () => {
        await prisma.saleItem.deleteMany({ where: { sale_id: { in: saleIds } } });
        await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
        await prisma.stockLedger.deleteMany({ where: { item_id: item } });
        await prisma.item.delete({ where: { id: item } });
        await purgeAuditLog({ where: { changed_by_id: actor } });
        await prisma.profiles.delete({ where: { id: actor } });
    });

    test("a sale takes its quantity out of the warehouse and links the ledger row to the sale", async () => {
        const s = await sell(4);
        saleIds.push(s!.id);
        expect(await onHand()).toBe(6);
        const out = await prisma.stockLedger.findMany({
            where: { ref_type: "SALE", ref_id: s!.id },
        });
        expect(out).toHaveLength(1);
        expect(out[0]!.direction).toBe("OUT");
    });

    test("selling more than is in stock is refused and writes nothing", async () => {
        const before = await prisma.sale.count();
        await expect(sell(7)).rejects.toMatchObject({ status: 409 });
        expect(await prisma.sale.count()).toBe(before);
        expect(await onHand()).toBe(6);
    });

    test("two lines of one item are checked together", async () => {
        await expect(
            sell(0, {
                items: [
                    { item_id: item, quantity: 4, unit: "BAG", unit_price: 10 },
                    { item_id: item, quantity: 4, unit: "BAG", unit_price: 10 },
                ],
            }),
        ).rejects.toMatchObject({ status: 409 });
        expect(await onHand()).toBe(6);
    });

    test("farm-made items are their own kind of sale: no warehouse, no stock", async () => {
        const litter = (
            await prisma.item.create({
                data: {
                    name: `Litter ${crypto.randomUUID()}`,
                    normalized_key: `litter ${crypto.randomUUID()}`,
                    category: "WASTE",
                    unit: "KG",
                    is_farm_made: true,
                },
            })
        ).id;
        try {
            const litterLine = { item_id: litter, quantity: 500, unit: "KG", unit_price: 2 };
            const s = await sell(0, {
                kind: "FARM_MADE",
                warehouse_id: undefined,
                items: [litterLine],
            });
            saleIds.push(s!.id);
            expect(s!.kind).toBe("FARM_MADE");
            expect(s!.total.toNumber()).toBe(1000);
            expect(await prisma.stockLedger.count({ where: { ref_id: s!.id } })).toBe(0);

            // Mixed with bought stock it's refused: one kind per sale.
            await expect(
                sell(0, {
                    kind: "FARM_MADE",
                    warehouse_id: undefined,
                    items: [
                        litterLine,
                        { item_id: item, quantity: 1, unit: "BAG", unit_price: 10 },
                    ],
                }),
            ).rejects.toMatchObject({ status: 400 });
            expect(await onHand()).toBe(6);
        } finally {
            await prisma.saleItem.deleteMany({ where: { item_id: litter } });
            await prisma.item.delete({ where: { id: litter } });
        }
    });

    test("bought-stock sale needs a warehouse and stores it", async () => {
        await expect(sell(1, { warehouse_id: undefined })).rejects.toMatchObject({ status: 400 });
        const s = await sell(1);
        saleIds.push(s!.id);
        expect(s!.kind).toBe("STOCK");
        expect(s!.warehouse_id).toBe(wh);
    });
});

describe("SaleService kinds", () => {
    let wh: string;
    let actor: string;
    let purchaseId: string;
    const items: Record<"coded" | "plain" | "farm" | "equipment", string> = {
        coded: "",
        plain: "",
        farm: "",
        equipment: "",
    };
    const saleIds: string[] = [];
    const newItem = (over: Record<string, unknown>) =>
        prisma.item
            .create({
                data: {
                    name: `Kind Item ${crypto.randomUUID()}`,
                    normalized_key: `kind item ${crypto.randomUUID()}`,
                    category: "OTHER",
                    unit: "UNIT",
                    ...over,
                },
            })
            .then((i) => i.id);
    const sell = (
        kind: string,
        lines: Record<string, unknown>[],
        over: Record<string, unknown> = {},
    ) =>
        SaleService.create({
            kind,
            sale_date: new Date(),
            paid_amount: 0,
            recorded_by_id: actor,
            items: lines,
            ...over,
        } as never).then((s) => {
            saleIds.push(s!.id);
            return s!;
        });
    const bottles = (n: number) => ({ item_id: items.coded, quantity: n, unit_price: 50 });

    beforeAll(async () => {
        wh = await sharedWarehouseId();
        actor = (
            await prisma.profiles.create({
                data: {
                    name: "Kind Sale Actor",
                    mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                    role: "ADMIN",
                },
            })
        ).id;
        items.coded = await newItem({ category: "MEDICINE", unit: "LITER", is_unit_tracked: true });
        items.plain = await newItem({ category: "FEED", unit: "KG" });
        items.farm = await newItem({ category: "WASTE", unit: "KG", is_farm_made: true });
        items.equipment = await newItem({
            category: "EQUIPMENT",
            unit: "UNIT",
            is_unit_tracked: true,
        });
        await seedStock(items.plain, wh, 100);
        purchaseId = (
            await prisma.purchase.create({
                data: {
                    warehouse_id: wh,
                    purchase_date: new Date(),
                    total_amount: 300,
                    paid_amount: 0,
                    due_amount: 300,
                    recorded_by_id: actor,
                },
            })
        ).id;
        // Three sealed bottles of the coded item, and one of the equipment item.
        for (const [item_id, count] of [
            [items.coded, 3],
            [items.equipment, 1],
        ] as const) {
            const lot = await prisma.purchaseItem.create({
                data: {
                    purchase_id: purchaseId,
                    item_id,
                    quantity: count,
                    unit: "UNIT",
                    base_quantity: count,
                    unit_count: count,
                    unit_price: 100,
                    total_price: 100 * count,
                },
            });
            await prisma.stockUnit.createMany({
                data: Array.from({ length: count }, () => ({
                    purchase_item_id: lot.id,
                    status: "BOUND" as const,
                })),
            });
        }
    });

    afterAll(async () => {
        const all = Object.values(items);
        await prisma.saleItem.deleteMany({ where: { sale_id: { in: saleIds } } });
        await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
        await prisma.stockUnit.deleteMany({
            where: { purchase_item: { purchase_id: purchaseId } },
        });
        await prisma.purchaseItem.deleteMany({ where: { purchase_id: purchaseId } });
        await prisma.purchase.delete({ where: { id: purchaseId } });
        await prisma.stockLedger.deleteMany({ where: { item_id: { in: all } } });
        await prisma.item.deleteMany({ where: { id: { in: all } } });
        await purgeAuditLog({ where: { changed_by_id: actor } });
        await prisma.profiles.delete({ where: { id: actor } });
    });

    test("each kind only takes its own items", async () => {
        const line = (item_id: string) => ({ item_id, quantity: 1, unit: "KG", unit_price: 10 });
        const cases: [string, string, Record<string, unknown>][] = [
            ["CODED", items.plain, {}],
            ["STOCK", items.coded, { warehouse_id: wh }],
            ["STOCK", items.farm, { warehouse_id: wh }],
            ["FARM_MADE", items.plain, {}],
        ];
        for (const [kind, item_id, over] of cases) {
            const name = (await prisma.item.findUniqueOrThrow({ where: { id: item_id } })).name;
            const attempt = sell(kind, [line(item_id)], over);
            await expect(attempt).rejects.toMatchObject({ status: 400 });
            await expect(attempt).rejects.toThrow(name);
        }
    });

    test("QR sale: whole bottles only, no stock leaves at save", async () => {
        await expect(sell("CODED", [bottles(1.5)])).rejects.toMatchObject({ status: 400 });
        const s = await sell("CODED", [bottles(2)]);
        expect(s.kind).toBe("CODED");
        expect(s.warehouse_id).toBeNull();
        expect(s.items[0]!.unit).toBeNull();
        expect(s.total.toNumber()).toBe(100);
        expect(await prisma.stockLedger.count({ where: { ref_type: "SALE", ref_id: s.id } })).toBe(
            0,
        );
        expect(
            await prisma.stockUnit.count({
                where: { purchase_item: { item_id: items.coded }, status: "BOUND" },
            }),
        ).toBe(3);
    });

    test("QR sale can't ask for more sealed bottles than exist", async () => {
        const attempt = sell("CODED", [bottles(4)]);
        await expect(attempt).rejects.toMatchObject({ status: 409 });
        await expect(attempt).rejects.toThrow(/3/);
    });

    test("QR sale refuses equipment", async () => {
        const attempt = sell("CODED", [{ item_id: items.equipment, quantity: 1, unit_price: 500 }]);
        await expect(attempt).rejects.toMatchObject({ status: 400 });
        await expect(attempt).rejects.toThrow("Equipment can't be sold yet");
    });

    test("farm-made sale needs no warehouse and moves no stock", async () => {
        const s = await sell("FARM_MADE", [
            { item_id: items.farm, quantity: 200, unit: "KG", unit_price: 3 },
        ]);
        expect(s.warehouse_id).toBeNull();
        expect(await prisma.stockLedger.count({ where: { ref_id: s.id } })).toBe(0);
    });

    test("list shows kind and scan progress", async () => {
        const coded = await sell("CODED", [bottles(2)]);
        const sealed = await prisma.stockUnit.findFirstOrThrow({
            where: { status: "BOUND", purchase_item: { item_id: items.coded } },
        });
        await SaleScanService.scan(coded.id, sealed.id, actor);
        const stock = await sell(
            "STOCK",
            [{ item_id: items.plain, quantity: 1, unit: "KG", unit_price: 9 }],
            {
                warehouse_id: wh,
            },
        );

        const { sales } = await SaleService.getAll({ page: 1, limit: 100 } as never);
        const row = (id: string) => sales.find((x) => x.id === id)!;
        expect(row(coded.id)).toMatchObject({ kind: "CODED", scan: { needed: 2, scanned: 1 } });
        expect(row(stock.id)).toMatchObject({ kind: "STOCK", warehouse_id: wh, scan: null });

        const onlyCoded = await SaleService.getAll({ page: 1, limit: 100, kind: "CODED" } as never);
        expect(onlyCoded.sales.every((x) => x.kind === "CODED")).toBe(true);
        expect(onlyCoded.sales.map((x) => x.id)).not.toContain(stock.id);
    });

    test("detail lists scanned bottles", async () => {
        const coded = await sell("CODED", [bottles(1)]);
        const sealed = await prisma.stockUnit.findFirstOrThrow({
            where: { status: "BOUND", purchase_item: { item_id: items.coded } },
        });
        await SaleScanService.scan(coded.id, sealed.id, actor);
        const detail = await SaleService.getById(coded.id);
        expect(detail.items[0]!.scanned).toBe(1);
        expect(detail.bottles.map((b) => b.id)).toEqual([sealed.id]);
        expect(detail.warehouse).toBeNull();
    });

    test("sellable counts sealed bottles and warehouse balances", async () => {
        const sealed = await prisma.stockUnit.count({
            where: { status: "BOUND", purchase_item: { item_id: items.coded } },
        });
        const coded = await SaleService.sellable({ kind: "CODED" });
        expect(coded.find((r) => r.item_id === items.coded)?.available).toBe(sealed);
        expect(coded.find((r) => r.item_id === items.equipment)).toBeUndefined(); // equipment can't be sold yet

        const stock = await SaleService.sellable({ kind: "STOCK", warehouse_id: wh });
        const onHand = await prisma.$transaction((tx) =>
            getItemLocationBalance(tx, items.plain, "WAREHOUSE", wh),
        );
        expect(stock.find((r) => r.item_id === items.plain)?.available).toBe(onHand.toString());
        expect(stock.find((r) => r.item_id === items.coded)).toBeUndefined();
    });

    test("a payload without kind is a bought-stock sale (clients from before kinds keep working)", async () => {
        const parsed = createSaleSchema.parse({
            sale_date: new Date().toISOString(),
            warehouse_id: wh,
            items: [{ item_id: items.plain, quantity: 1, unit: "KG", unit_price: 9 }],
        });
        expect(parsed.kind).toBe("STOCK");
    });

    test("a unit used on a sale line can't be deleted", async () => {
        const code = `SALE_TEST_${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
        const unit = await prisma.unit.create({ data: { code, label: code } });
        const s = await prisma.sale.create({
            data: {
                kind: "FARM_MADE",
                sale_date: new Date(),
                total: 1,
                paid_amount: 0,
                due_amount: 1,
                recorded_by_id: actor,
                items: {
                    create: [
                        {
                            item_id: items.farm,
                            quantity: 1,
                            unit: code,
                            unit_price: 1,
                            total_price: 1,
                        },
                    ],
                },
            },
        });
        saleIds.push(s.id);
        try {
            await expect(
                createLookupService(prisma.unit, "Unit").remove(unit.id),
            ).rejects.toMatchObject({
                status: 409,
            });
            expect(
                (await prisma.saleItem.findFirstOrThrow({ where: { sale_id: s.id } })).unit,
            ).toBe(code);
        } finally {
            await prisma.saleItem.deleteMany({ where: { sale_id: s.id } });
            await prisma.unit.deleteMany({ where: { id: unit.id } });
        }
    });
});
