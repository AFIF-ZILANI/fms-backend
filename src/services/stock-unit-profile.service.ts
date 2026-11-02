import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { codedRemaining } from "@lib/coded-stock";

const by = { select: { name: true } } as const;

/**
 * Everything known about one QR-coded unit, for the app's "Scan to look up": what it is, the purchase lot
 * it came from (price, supplier, dates), where it is now and how much is left, every move and every use.
 * A blank code (not yet bound to a lot) comes back with `item`/`lot` null and the app says so.
 *
 * Read-only and one request, so a single scan fills the screen.
 */
export async function stockUnitProfile(id: string) {
    const unit = await prisma.stockUnit.findUnique({
        where: { id },
        include: {
            bound_by: by,
            asset: { select: { name: true, status: true } },
            purchase_item: {
                include: {
                    item: { select: { id: true, name: true, category: true, unit: true } },
                    purchase: {
                        include: {
                            supplier: {
                                select: {
                                    company: true,
                                    profile: { select: { name: true, mobile: true } },
                                },
                            },
                            warehouse: { select: { name: true } },
                            recorded_by: by,
                        },
                    },
                },
            },
            houseAllocations: {
                orderBy: [{ occurred_at: "desc" }, { created_at: "desc" }],
                include: {
                    house: { select: { name: true } },
                    stock_transfer: { select: { recorded_by: by } },
                },
            },
            consumptions: {
                orderBy: { date: "desc" },
                include: {
                    house: { select: { name: true } },
                    batch: { select: { batch_code: true } },
                    recorded_by: by,
                    medications: { select: { medicine_name: true } },
                    vaccinations: { select: { vaccine_name: true } },
                },
            },
        },
    });
    if (!unit) throw AppError.notFound("StockUnit");

    const lot = unit.purchase_item;
    const [remaining, siblings] = lot
        ? await Promise.all([
              codedRemaining(prisma, unit.id, lot),
              prisma.stockUnit.groupBy({
                  by: ["status"],
                  where: { purchase_item_id: lot.id },
                  _count: { _all: true },
              }),
          ])
        : [null, []];

    // Where it is now: its latest move, or the warehouse it was bought into when it never moved.
    const latest = unit.houseAllocations[0];
    const location = !lot
        ? null
        : latest?.house
          ? { type: "HOUSE" as const, name: latest.house.name, since: latest.occurred_at }
          : {
                type: "WAREHOUSE" as const,
                name: lot.purchase.warehouse.name,
                since: latest?.occurred_at ?? unit.bound_at,
            };

    return {
        id: unit.id,
        status: unit.status,
        bound_at: unit.bound_at,
        bound_by: unit.bound_by?.name ?? null,
        asset: unit.asset,
        item: lot?.item ?? null,
        location,
        remaining: remaining && {
            unit: remaining.unit?.toString() ?? null,
            lot: remaining.lot.toString(),
        },
        lot: lot && {
            id: lot.id,
            quantity: lot.quantity.toString(),
            unit: lot.unit,
            base_quantity: lot.base_quantity.toString(),
            unit_count: lot.unit_count,
            unit_price: lot.unit_price.toString(),
            total_price: lot.total_price.toString(),
            // What one coded unit cost, when the lot says how many units it holds.
            cost_per_unit: lot.unit_count
                ? lot.total_price.dividedBy(lot.unit_count).toDecimalPlaces(2).toString()
                : null,
            mfg_date: lot.mfg_date,
            expiration_date: lot.expiration_date,
            codes: Object.fromEntries(siblings.map((s) => [s.status, s._count._all])) as Record<
                string,
                number
            >,
        },
        purchase: lot && {
            id: lot.purchase.id,
            purchase_date: lot.purchase.purchase_date,
            invoice_no: lot.purchase.invoice_no,
            warehouse: lot.purchase.warehouse.name,
            recorded_by: lot.purchase.recorded_by.name,
            supplier: lot.purchase.supplier && {
                name: lot.purchase.supplier.profile.name,
                company: lot.purchase.supplier.company,
                mobile: lot.purchase.supplier.profile.mobile,
            },
        },
        movements: unit.houseAllocations.map((a) => ({
            id: a.id,
            type: a.type,
            // null = back to the warehouse
            house: a.house?.name ?? null,
            at: a.occurred_at,
            by: a.stock_transfer?.recorded_by.name ?? null,
        })),
        uses: unit.consumptions.map((u) => ({
            id: u.id,
            at: u.date,
            house: u.house.name,
            quantity: u.quantity.toString(),
            unit: u.unit,
            batch_code: u.batch?.batch_code ?? null,
            by: u.recorded_by.name,
            note: u.note,
            treatment: u.medications[0]?.medicine_name ?? u.vaccinations[0]?.vaccine_name ?? null,
        })),
    };
}
