import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { SaleService } from "./sale.service";
import { SaleScanService } from "./sale-scan.service";
import { sharedWarehouseId, purgeAuditLog } from "@lib/test-fixtures";

describe("SaleScanService", () => {
    let wh: string;
    let actor: string;
    let purchaseId: string;
    let x: { id: string; name: string };
    let y: { id: string; name: string };
    let plain: string;
    // saleA: X x 2, saleB: X x 1 (stays waiting), saleC: X x 1 (the race), stockSale: not QR
    const sale: Record<"a" | "b" | "c" | "stock", string> = { a: "", b: "", c: "", stock: "" };
    let lot1: string[]; // three sealed X bottles, 100 each (lot of 300 in 3)
    let raceUnits: string[]; // two more sealed X bottles
    let openedX: string; // an opened X bottle
    let yUnit: string;
    const itemIds: string[] = [];

    const newItem = async (name: string, over: Record<string, unknown> = {}) => {
        const item = await prisma.item.create({
            data: {
                name: `${name} ${crypto.randomUUID()}`,
                normalized_key: `${name.toLowerCase()} ${crypto.randomUUID()}`,
                category: "MEDICINE",
                unit: "LITER",
                is_unit_tracked: true,
                ...over,
            },
        });
        itemIds.push(item.id);
        return item;
    };
    const lotOf = async (item_id: string, count: number, status: "BOUND" | "IN_USE" = "BOUND") => {
        const lot = await prisma.purchaseItem.create({
            data: {
                purchase_id: purchaseId,
                item_id,
                quantity: count * 100,
                unit: "LITER",
                base_quantity: count * 100,
                unit_count: count,
                unit_price: 1,
                total_price: count * 100,
            },
        });
        const ids = Array.from({ length: count }, () => crypto.randomUUID());
        await prisma.stockUnit.createMany({
            data: ids.map((id) => ({ id, purchase_item_id: lot.id, status })),
        });
        return ids;
    };
    const codedSale = async (quantity: number) =>
        (await SaleService.create({
            kind: "CODED",
            sale_date: new Date(),
            paid_amount: 0,
            recorded_by_id: actor,
            items: [{ item_id: x.id, quantity, unit_price: 80 }],
        }))!.id;

    beforeAll(async () => {
        wh = await sharedWarehouseId();
        actor = (
            await prisma.profiles.create({
                data: {
                    name: "Scan Manager",
                    mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                    role: "ADMIN",
                },
            })
        ).id;
        purchaseId = (
            await prisma.purchase.create({
                data: {
                    warehouse_id: wh,
                    purchase_date: new Date("2026-11-01"),
                    total_amount: 1000,
                    paid_amount: 0,
                    due_amount: 1000,
                    recorded_by_id: actor,
                },
            })
        ).id;
        x = await newItem("Vaccine X");
        y = await newItem("Vaccine Y");
        plain = (await newItem("Feed", { category: "FEED", unit: "KG", is_unit_tracked: false }))
            .id;
        lot1 = await lotOf(x.id, 3);
        raceUnits = await lotOf(x.id, 2);
        [openedX] = (await lotOf(x.id, 1, "IN_USE")) as [string];
        [yUnit] = (await lotOf(y.id, 1)) as [string];
        sale.a = await codedSale(2);
        sale.b = await codedSale(1);
        sale.c = await codedSale(1);
        sale.stock = (
            await prisma.sale.create({
                data: {
                    kind: "STOCK",
                    sale_date: new Date(),
                    total: 10,
                    paid_amount: 0,
                    due_amount: 10,
                    recorded_by_id: actor,
                    items: {
                        create: [
                            {
                                item_id: plain,
                                quantity: 1,
                                unit: "KG",
                                unit_price: 10,
                                total_price: 10,
                            },
                        ],
                    },
                },
            })
        ).id;
    });

    afterAll(async () => {
        const saleIds = Object.values(sale);
        await prisma.stockUnit.deleteMany({
            where: { purchase_item: { purchase_id: purchaseId } },
        });
        await prisma.saleItem.deleteMany({ where: { sale_id: { in: saleIds } } });
        await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
        await prisma.purchaseItem.deleteMany({ where: { purchase_id: purchaseId } });
        await prisma.purchase.delete({ where: { id: purchaseId } });
        await prisma.stockLedger.deleteMany({ where: { item_id: { in: itemIds } } });
        await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
        await purgeAuditLog({ where: { changed_by_id: actor } });
        await prisma.profiles.delete({ where: { id: actor } });
    });

    test("scanning a sealed bottle sells it", async () => {
        const result = await SaleScanService.scan(sale.a, lot1[0]!, actor);
        expect(result).toMatchObject({
            scanned: 1,
            quantity: 2,
            sale_done: false,
            item_name: x.name,
        });

        const unit = await prisma.stockUnit.findUniqueOrThrow({ where: { id: lot1[0]! } });
        expect(unit.status).toBe("SOLD");
        expect(unit.sale_item_id).toBe(result.line_id);
        expect(unit.sold_by_id).toBe(actor);
        expect(unit.sold_at).toBeInstanceOf(Date);

        const rows = await prisma.stockLedger.findMany({ where: { ref_id: lot1[0]! } });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            direction: "OUT",
            reason: "SALE",
            ref_type: "SALE",
            location_type: "WAREHOUSE",
            location_id: wh,
        });
        expect(rows[0]!.quantity.toNumber()).toBe(100);
        expect(
            await prisma.auditLog.count({
                where: { table_name: "StockUnit", record_id: lot1[0]! },
            }),
        ).toBe(1);
    });

    test("same bottle twice on the same line is a no-op", async () => {
        const again = await SaleScanService.scan(sale.a, lot1[0]!, actor);
        expect(again.scanned).toBe(1);
        expect(await prisma.stockLedger.count({ where: { ref_id: lot1[0]! } })).toBe(1);
    });

    test("refusals", async () => {
        const refused = async (sale_id: string, unit_id: string, status: number, text: string) => {
            const attempt = SaleScanService.scan(sale_id, unit_id, actor);
            await expect(attempt).rejects.toMatchObject({ status });
            await expect(attempt).rejects.toThrow(text);
        };
        await refused(sale.a, crypto.randomUUID(), 404, "This code isn't in the system");
        await refused(sale.a, openedX, 409, "This pack has been opened");
        await refused(sale.a, yUnit, 409, `${y.name} isn't on this sale`);
        await refused(sale.stock, lot1[1]!, 409, "This sale isn't for QR items");
        await refused(sale.b, lot1[0]!, 409, "Already sold");
    });

    test("a full line refuses more", async () => {
        const second = await SaleScanService.scan(sale.a, lot1[1]!, actor);
        expect(second).toMatchObject({ scanned: 2, quantity: 2, sale_done: true });
        const attempt = SaleScanService.scan(sale.a, lot1[2]!, actor);
        await expect(attempt).rejects.toMatchObject({ status: 409 });
        await expect(attempt).rejects.toThrow(`All 2 ${x.name} packs are already scanned`);
        expect((await prisma.stockUnit.findUniqueOrThrow({ where: { id: lot1[2]! } })).status).toBe(
            "BOUND",
        );
    });

    test("two scans racing for the last slot: exactly one lands", async () => {
        const results = await Promise.allSettled(
            raceUnits.map((id) => SaleScanService.scan(sale.c, id, actor)),
        );
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
        expect(loser.reason).toMatchObject({ status: 409 });
        expect((loser.reason as Error).message).toBe(`All 1 ${x.name} packs are already scanned`);
        expect(
            await prisma.stockUnit.count({ where: { id: { in: raceUnits }, status: "SOLD" } }),
        ).toBe(1);
    });

    test("waiting list and detail carry no money", async () => {
        const waiting = (await SaleScanService.waiting()).map((s) => s.id);
        expect(waiting).toContain(sale.b);
        expect(waiting).not.toContain(sale.a);
        expect(waiting).not.toContain(sale.stock);

        const detail = await SaleScanService.get(sale.a);
        expect(detail.lines).toEqual([
            { id: expect.any(String), item_name: x.name, quantity: 2, scanned: 2 },
        ]);
        expect(detail.bottles).toHaveLength(2);
        expect(detail.bottles[0]).toMatchObject({
            size: "100",
            unit: "LITER",
            sold_by: "Scan Manager",
        });
        const json = JSON.stringify([detail, await SaleScanService.waiting()]);
        for (const money of ["total", "unit_price", "paid_amount", "due_amount"])
            expect(json).not.toContain(money);
    });

    test("equipment is refused at scan too", async () => {
        const heater = await newItem("Heater", { category: "EQUIPMENT", unit: "UNIT" });
        const [unit] = (await lotOf(heater.id, 1)) as [string];
        const attempt = SaleScanService.scan(sale.b, unit, actor);
        await expect(attempt).rejects.toMatchObject({ status: 409 });
        await expect(attempt).rejects.toThrow("Equipment can't be sold yet");
    });
});
