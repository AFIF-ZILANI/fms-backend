/**
 * Inventory feature simulation, driven through the real HTTP API (in-process) and audited against the
 * database: catalog (items, unit conversions, warehouses, organizations), purchases (discounts, units,
 * payments), QR-coded units (provision, bind, lots, relocate, status, dispose, delete), aggregate stock
 * transfers, consumption (aggregate + coded), inventory adjustments, assets + depreciation, alerts,
 * concurrency, and the stock reports.
 *
 *   bun scripts/inventory-sim.ts
 *
 * Needs the running batch from `batch-lifecycle-sim.ts 3` (consumption is booked against it). Writes to the
 * dev database and does not clean up. Report: docs/inventory-sim-report.md
 */
process.env.RATE_LIMIT_MAX = "10000000";
const realLog = console.log;
console.log = () => {};
const { app } = await import("../src/App");
const { default: prisma } = await import("../src/lib/db");
const { signSession } = await import("../src/lib/session");
const { writeFileSync } = await import("node:fs");
const out = (s = "") => process.stdout.write(s + "\n");

// ── harness ─────────────────────────────────────────────────────────────────
type Who = "admin" | "worker" | "manager";
const tokens = {} as Record<Who, string>;
type Res = { status: number; body: any; data: any };
async function api(who: Who | null, method: string, path: string, body?: unknown): Promise<Res> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (who) headers.Authorization = `Bearer ${tokens[who]}`;
    const res = await app.request("/api" + path, { method, headers, ...(body !== undefined && { body: JSON.stringify(body) }) });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, body: json, data: json?.data };
}
const checks: { name: string; pass: boolean; detail: string; section: string }[] = [];
const findings: { sev: "BUG" | "GAP" | "NOTE"; text: string }[] = [];
let section = "";
const check = (name: string, pass: boolean, detail = "") => {
    checks.push({ name, pass, detail, section });
    if (!pass) out(`  ✗ [${section}] ${name} ${detail}`);
    return pass;
};
const finding = (sev: "BUG" | "GAP" | "NOTE", text: string) => findings.push({ sev, text });
/** A correct refusal/acceptance is a passing check; the wrong one is a failed check AND a finding. */
const probe = (name: string, r: Res, want: number | number[], bug: string) => {
    const ok = [want].flat().includes(r.status);
    check(name, ok, `status ${r.status} ${ok ? "" : JSON.stringify(r.body).slice(0, 160)}`);
    if (!ok) finding("BUG", `${name}: ${bug} (got ${r.status}, wanted ${[want].flat().join("/")}).`);
    return r;
};
async function must(who: Who, method: string, path: string, body?: unknown, label = `${method} ${path}`) {
    const r = await api(who, method, path, body);
    if (r.status >= 300) {
        check(`HTTP ok: ${label}`, false, `-> ${r.status} ${JSON.stringify(r.body).slice(0, 240)}`);
        return null;
    }
    return r.data;
}
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const sum = (xs: any[], f: (x: any) => number) => xs.reduce((s, x) => s + f(x), 0);
const ago = (days: number, h = 10) => new Date(Date.now() - days * 86_400_000 + (h - 12) * 3_600_000);
const uuid = () => crypto.randomUUID();

// ── ledger model: what the stock ledger SHOULD say, per item and place ──────
const L = new Map<string, number>();
const key = (item: string, lt: string | null, lid: string | null) => `${item}|${lt ?? "-"}|${lid ?? "-"}`;
const mv = (item: string, lt: string | null, lid: string | null, d: number) => L.set(key(item, lt, lid), r3((L.get(key(item, lt, lid)) ?? 0) + d));
const bal = (item: string, lt: string | null, lid: string | null) => L.get(key(item, lt, lid)) ?? 0;
const itemTotal = (item: string) => r3([...L.entries()].filter(([k]) => k.startsWith(item + "|")).reduce((s, [, v]) => s + v, 0));

// ── actors and places ───────────────────────────────────────────────────────
const t0 = Date.now();
const adminP = await prisma.profiles.findFirstOrThrow({ where: { name: "AFIF ZILANI", role: "ADMIN" } });
const workerP = await prisma.profiles.findFirstOrThrow({ where: { name: "Test Worker" } });
const managerP = await prisma.profiles.findFirstOrThrow({ where: { name: "Test Manager" } });
for (const [w, p] of [["admin", adminP], ["worker", workerP], ["manager", managerP]] as const) tokens[w] = await signSession(p.id, p.password_changed_at, "web");
const batch = await prisma.batches.findFirstOrThrow({ where: { batch_code: "SIM3-2026-09-16" } });
const houseA = await prisma.houses.findFirstOrThrow({ where: { type: "GROWER", number: 3 } }); // holds the running batch
const houseB = await prisma.houses.findFirstOrThrow({ where: { type: "BROODER", number: 2 } }); // empty
const houseBPhase = houseB.phase;
const wh1 = await prisma.warehouses.findFirstOrThrow({ where: { name: "Main Warehouse Kunduna" } });
const bank = await prisma.paymentInstrument.findFirstOrThrow({ where: { label: "ZEROD FARMS BANK" } });
const supMill = await prisma.suppliers.findFirstOrThrow({ where: { profile: { name: "SIM3 Feed Mill" } } });
const supVet = await prisma.suppliers.findFirstOrThrow({ where: { profile: { name: "SIM3 Vet Pharma" } } });
out(`Inventory sim: houseA=${houseA.name} (batch ${batch.batch_code}), houseB=${houseB.name}`);

// ═══ 1. catalog ═════════════════════════════════════════════════════════════
section = "1 catalog";
const mkItem = async (name: string, category: string, unit: string, extra: object = {}) => (await must("admin", "POST", "/items", { name, category, unit, ...extra }, `item ${name}`))?.id as string;
const it = {
    feed: await mkItem("INV Broiler Feed", "FEED", "KG", { reorder_level: 50, supplier_ids: [supMill.id] }),
    premix: await mkItem("INV Vitamin Premix", "SUPPLEMENT", "KG"),
    vacc: await mkItem("INV Newcastle Vaccine", "VACCINE", "DOSE", { is_unit_tracked: true }),
    drug: await mkItem("INV Antibiotic", "MEDICINE", "LITER", { is_unit_tracked: true }),
    heater: await mkItem("INV Brooder Heater", "EQUIPMENT", "UNIT", { is_unit_tracked: true }),
    spare: await mkItem("INV Never Used Item", "OTHER", "PCS"),
};
probe("duplicate item name (different case) -> 409", await api("admin", "POST", "/items", { name: "inv broiler feed", category: "FEED", unit: "KG" }), 409, "normalized_key should stop case-variant duplicates");
probe("item in unknown category -> 400", await api("admin", "POST", "/items", { name: "INV Bad Cat", category: "NOPE", unit: "KG" }), 400, "unknown category should be refused");
probe("item with a derived base unit -> 400", await api("admin", "POST", "/items", { name: "INV Bad Unit", category: "FEED", unit: "BAG" }), 400, "Item.unit must be a canonical base unit");
// unit conversions
probe("ItemUnit BAG on a KG item", await api("admin", "POST", "/item-units", { item_id: it.feed, unit: "BAG", factor_to_base: 50, is_purchasable: true }), 201, "valid conversion refused");
probe("ItemUnit = the base unit -> 400", await api("admin", "POST", "/item-units", { item_id: it.feed, unit: "KG", factor_to_base: 1 }), 400, "base unit needs no conversion");
probe("ItemUnit from another family (LITER on KG item) -> 400", await api("admin", "POST", "/item-units", { item_id: it.feed, unit: "LITER", factor_to_base: 1 }), 400, "cross-family conversion accepted");
probe("duplicate ItemUnit -> 409", await api("admin", "POST", "/item-units", { item_id: it.feed, unit: "BAG", factor_to_base: 50 }), 409, "same conversion twice");
const iuMl = await api("admin", "POST", "/item-units", { item_id: it.drug, unit: "ML", factor_to_base: 5, is_purchasable: false, is_usable: true });
check("fixed_factor wins over a typo'd factor (ML stored as 0.001, sent 5)", iuMl.status === 201 && Number(iuMl.data?.factor_to_base) === 0.001, `${iuMl.data?.factor_to_base}`);
await must("admin", "POST", "/item-units", { item_id: it.premix, unit: "G", factor_to_base: 0.001, is_purchasable: false, is_usable: true });
probe("ItemUnit KG-family unit (SACHETS) on a PCS item -> 400", await api("admin", "POST", "/item-units", { item_id: it.spare, unit: "SACHETS", factor_to_base: 1 }), 400, "cross-family conversion accepted");
// warehouses
const whTemp = await must("admin", "POST", "/warehouses", { name: "INV Temp Store" }, "warehouse");
check("rename warehouse", (await api("admin", "PATCH", `/warehouses/${whTemp?.id}`, { name: "INV Temp Store 2" })).data?.name === "INV Temp Store 2");
probe("delete an unused warehouse", await api("admin", "DELETE", `/warehouses/${whTemp?.id}`), [200, 204], "unused warehouse should delete");
const wh2 = await must("admin", "POST", "/warehouses", { name: "INV Annex Store" }, "annex");
probe("delete a warehouse with stock history -> 409", await api("admin", "DELETE", `/warehouses/${wh1.id}`), 409, "warehouse with history must not delete");
// organizations
const org = await must("admin", "POST", "/organizations", { label_name: "INV Poultry Labs" }, "org");
const link = await must("admin", "POST", "/item-organizations", { item_id: it.vacc, organization_id: org?.id, role: "MANUFACTURER" }, "link org");
probe("duplicate item-organization link -> 409", await api("admin", "POST", "/item-organizations", { item_id: it.vacc, organization_id: org?.id, role: "MANUFACTURER" }), 409, "duplicate link accepted");
probe("remove item-organization link", await api("admin", "DELETE", `/item-organizations/${link?.id}`), [200, 204], "link should remove");
check("item shows its supplier link", ((await api("admin", "GET", `/items/${it.feed}`)).data?.suppliers ?? []).some((s: any) => s.id === supMill.id));

// ═══ 2. purchases + payments ════════════════════════════════════════════════
section = "2 purchases";
type Line = { item: string; qty: number; unit: string; price: number; disc?: ["FLAT" | "PERCENT", number]; mfg?: Date; exp?: Date };
const factor = (item: string, unit: string) => (item === it.feed && unit === "BAG" ? 50 : 1);
const purchases: { id: string; total: number; paid: number; label: string }[] = [];
async function buy(label: string, supplier: string, wh: string, lines: Line[], paid: number, g?: ["FLAT" | "PERCENT", number], inst = bank.id) {
    const gross = lines.map((l) => {
        const base = l.qty * l.price;
        const d = !l.disc ? 0 : l.disc[0] === "FLAT" ? l.disc[1] : (base * l.disc[1]) / 100;
        return { l, net: base - d };
    });
    const sub = sum(gross, (x) => x.net);
    const total = r2(sub - (!g ? 0 : g[0] === "FLAT" ? g[1] : (sub * g[1]) / 100));
    const p = await must("admin", "POST", "/purchases", {
        supplier_id: supplier, warehouse_id: wh, purchase_date: ago(14), invoice_no: `INV-${label}`, paid_amount: paid,
        ...(paid > 0 && { paid_from_instrument_id: inst }),
        ...(g && { discount_type: g[0], discount_value: g[1] }),
        items: lines.map((l) => ({ item_id: l.item, quantity: l.qty, unit: l.unit, unit_price: l.price, ...(l.disc && { discount_type: l.disc[0], discount_value: l.disc[1] }), ...(l.mfg && { mfg_date: l.mfg }), ...(l.exp && { expiration_date: l.exp }) })),
    }, `purchase ${label}`);
    if (!p) return null;
    check(`purchase ${label}: total = Σ line nets - discount`, r2(Number(p.total_amount)) === total, `${p.total_amount} vs ${total}`);
    for (const { l, net } of gross) mv(l.item, "WAREHOUSE", wh, l.qty * factor(l.item, l.unit));
    purchases.push({ id: p.id, total, paid, label });
    return { p, gross, total };
}
const P1 = await buy("P1-feed", supMill.id, wh1.id, [
    { item: it.feed, qty: 20, unit: "BAG", price: 3000, disc: ["PERCENT", 5] },
    { item: it.premix, qty: 10, unit: "KG", price: 400, disc: ["FLAT", 200] },
], 24000, ["FLAT", 500]);
const feedLedger = await prisma.stockLedger.findFirst({ where: { item_id: it.feed, reason: "PURCHASE" } });
check("ledger IN: 20 BAG -> 1000 kg at WAREHOUSE with net unit cost 57/kg", feedLedger?.direction === "IN" && Number(feedLedger.quantity) === 1000 && Number(feedLedger.unit_cost) === 57, `${feedLedger?.quantity} @ ${feedLedger?.unit_cost}`);
const P2 = await buy("P2-vet", supVet.id, wh1.id, [
    { item: it.vacc, qty: 20000, unit: "DOSE", price: 0.12, mfg: ago(60), exp: new Date(Date.now() + 12 * 86_400_000) },
    { item: it.drug, qty: 3, unit: "LITER", price: 1500, exp: new Date(Date.now() + 200 * 86_400_000) },
    { item: it.heater, qty: 4, unit: "UNIT", price: 2500 },
], 0);
const P3 = await buy("P3-annex", supMill.id, wh2!.id, [{ item: it.feed, qty: 500, unit: "KG", price: 62 }], 31000);
const P4 = await buy("P4-heater-lot", supVet.id, wh1.id, [{ item: it.heater, qty: 2, unit: "UNIT", price: 2600 }], 0);
const lotOf = (p: any, i: number) => p!.p.items[i].id as string;
// refusals
const base = { supplier_id: supMill.id, warehouse_id: wh1.id, purchase_date: ago(1) };
const line = { item_id: it.feed, quantity: 1, unit: "KG", unit_price: 10 };
probe("discount_type without value -> 400", await api("admin", "POST", "/purchases", { ...base, items: [{ ...line, discount_type: "FLAT" }] }), 400, "half a discount accepted");
probe("PERCENT discount over 100 -> 400", await api("admin", "POST", "/purchases", { ...base, items: [{ ...line, discount_type: "PERCENT", discount_value: 150 }] }), 400, "negative net accepted");
probe("FLAT line discount bigger than the line -> 400", await api("admin", "POST", "/purchases", { ...base, items: [{ ...line, discount_type: "FLAT", discount_value: 99 }] }), 400, "negative net accepted");
probe("paid more than the total -> 400", await api("admin", "POST", "/purchases", { ...base, paid_amount: 999, paid_from_instrument_id: bank.id, items: [line] }), 400, "overpay at creation accepted");
probe("paid without an account -> 400", await api("admin", "POST", "/purchases", { ...base, paid_amount: 5, items: [line] }), 400, "payment with no source account accepted");
probe("BAG on an item with no conversion -> 400", await api("admin", "POST", "/purchases", { ...base, items: [{ ...line, item_id: it.premix, unit: "BAG" }] }), 400, "unconverted unit accepted");
probe("zero quantity -> 400", await api("admin", "POST", "/purchases", { ...base, items: [{ ...line, quantity: 0 }] }), 400, "zero quantity accepted");
probe("empty purchase -> 400", await api("admin", "POST", "/purchases", { ...base, items: [] }), 400, "no lines accepted");
probe("unknown item -> 400", await api("admin", "POST", "/purchases", { ...base, items: [{ ...line, item_id: uuid() }] }), 400, "unknown item accepted");
probe("unknown warehouse -> 4xx", await api("admin", "POST", "/purchases", { ...base, warehouse_id: uuid(), items: [line] }), [400, 404], "unknown warehouse accepted");
probe("worker cannot purchase -> 403", await api("worker", "POST", "/purchases", { ...base, items: [line] }), 403, "worker allowed to purchase");
check("no ledger rows leaked from refused purchases", (await prisma.stockLedger.count({ where: { item_id: it.feed, reason: "PURCHASE" } })) === 2);
// payments
if (P1) {
    const rest = r2(P1.total - 24000);
    probe("overpay a purchase -> 400", await api("admin", "POST", "/payments", { amount: rest + 1, payment_date: ago(5), ref_type: "PURCHASE", ref_id: P1.p.id, from_instrument_id: bank.id }), 400, "overpayment accepted");
    probe("pay a purchase without a source account -> 400", await api("admin", "POST", "/payments", { amount: 1, payment_date: ago(5), ref_type: "PURCHASE", ref_id: P1.p.id }), 400, "outgoing payment with no source accepted");
    await must("admin", "POST", "/payments", { amount: 10000, payment_date: ago(8), ref_type: "PURCHASE", ref_id: P1.p.id, from_instrument_id: bank.id }, "pay 1");
    const tp = (await api("admin", "GET", `/payments/total-paid?ref_type=PURCHASE&ref_id=${P1.p.id}`)).data;
    check("total paid = 24,000 + 10,000", Number(tp?.total_paid) === 34000, `${tp?.total_paid}`);
    await must("admin", "POST", "/payments", { amount: r2(rest - 10000), payment_date: ago(2), ref_type: "PURCHASE", ref_id: P1.p.id, from_instrument_id: bank.id }, "pay rest");
    probe("a fully paid purchase refuses more -> 400", await api("admin", "POST", "/payments", { amount: 1, payment_date: ago(1), ref_type: "PURCHASE", ref_id: P1.p.id, from_instrument_id: bank.id }), 400, "paid-up purchase took another payment");
    purchases[0]!.paid = P1.total;
}
const outstanding = ((await api("admin", "GET", "/payments/outstanding?ref_type=PURCHASE")).data ?? []) as { ref_id: string; total_paid: string }[];
check("payments list reflects all paid purchases", purchases.filter((p) => p.paid > 0).every((p) => outstanding.some((o) => o.ref_id === p.id)));

// ═══ 3. coded units ═════════════════════════════════════════════════════════
section = "3 coded units";
const provisioned: any[] = (await must("admin", "POST", "/stock-units", { count: 14 }, "provision")) ?? [];
check("14 blank codes provisioned UNASSIGNED", provisioned.length === 14 && provisioned.every((u) => u.status === "UNASSIGNED" && u.purchase_item_id === null));
probe("provision over the 500 cap -> 400", await api("admin", "POST", "/stock-units", { count: 501 }), 400, "cap not enforced");
const pool = provisioned.map((u) => u.id as string);
const vaccLot = P2 ? lotOf(P2, 0) : "", drugLot = P2 ? lotOf(P2, 1) : "", heaterLot = P2 ? lotOf(P2, 2) : "", heaterLot2 = P4 ? lotOf(P4, 0) : "";
const bind = (id: string, lot: string, n?: number, who: Who = "manager") => api(who, "POST", `/stock-units/${id}/bind`, { purchase_item_id: lot, ...(n !== undefined && { unit_count: n }) });
const bound: Record<string, string[]> = { vacc: [], drug: [], heater: [], heater2: [] };
for (let i = 0; i < 4; i++) { const r = await bind(pool.shift()!, vaccLot, 4); if (r.status === 200) bound.vacc.push(r.data.id); else check("bind vaccine vial", false, `${r.status}`); }
probe("5th vial on a lot split into 4 -> 409", await bind(pool[0]!, vaccLot, 4), 409, "lot overfilled");
probe("bind with a different unit_count than the lot's -> 409", await bind(pool[0]!, vaccLot, 9), 409, "lot size silently changed");
for (let i = 0; i < 3; i++) { const r = await bind(pool.shift()!, drugLot, 3); if (r.status === 200) bound.drug.push(r.data.id); }
for (let i = 0; i < 4; i++) { const r = await bind(pool.shift()!, heaterLot, 4); if (r.status === 200) bound.heater.push(r.data.id); }
probe("bind to a lot of a non-tracked item -> 400", await bind(pool[0]!, P1 ? lotOf(P1, 0) : "", 1), 400, "feed got a QR code");
probe("bind an already-bound code -> 409", await bind(bound.vacc[0]!, vaccLot), 409, "rebind accepted");
probe("bind needs a manager: worker -> 403", await bind(pool[0]!, heaterLot2, 2, "worker"), 403, "worker allowed to bind");
check("bound units are IN_STOCK with bound_by", (await prisma.stockUnit.findMany({ where: { id: { in: bound.vacc } } })).every((u) => u.status === "IN_STOCK" && u.bound_by_id === managerP.id));
// lot completion: bind without declaring a count, then complete
for (let i = 0; i < 2; i++) { const r = await bind(pool.shift()!, heaterLot2); if (r.status === 200) bound.heater2.push(r.data.id); }
probe("complete a lot with more units declared than linked -> 400", await api("manager", "POST", `/purchase-items/${heaterLot2}/complete`, { unit_count: 5 }), 400, "incomplete lot completed");
probe("complete a lot -> ok", await api("manager", "POST", `/purchase-items/${heaterLot2}/complete`, { unit_count: 2 }), 200, "complete failed");
probe("complete it again -> 409", await api("manager", "POST", `/purchase-items/${heaterLot2}/complete`, { unit_count: 2 }), 409, "double completion accepted");
probe("complete a lot that already has a count -> 409", await api("manager", "POST", `/purchase-items/${vaccLot}/complete`, { unit_count: 4 }), 409, "re-size accepted");
probe("complete a non-tracked lot -> 400", await api("manager", "POST", `/purchase-items/${P1 ? lotOf(P1, 0) : ""}/complete`, { unit_count: 2 }), 400, "feed lot completed");
const counts = (await api("admin", "GET", "/stock-units/counts")).data;
check("counts endpoint has UNASSIGNED and IN_STOCK", counts?.UNASSIGNED >= 1 && counts?.IN_STOCK >= 13, JSON.stringify(counts));
check("search by id fragment", ((await api("admin", "GET", `/stock-units?q=${bound.vacc[0]!.slice(0, 8)}`)).data ?? []).some((u: any) => u.id === bound.vacc[0]));
check("filter by category=VACCINE", ((await api("admin", "GET", "/stock-units?category=VACCINE&limit=100")).data ?? []).every((u: any) => u.purchase_item?.item?.category === "VACCINE"));
check("purchase-items list for the lot shows linked units", ((await api("manager", "GET", `/purchase-items?item_id=${it.vacc}`)).data ?? [])[0]?._count?.stockUnits === 4);

// ═══ 4. allocation: relocate + transfers ════════════════════════════════════
section = "4 allocation";
const reloc = (id: string, house: string | null, who: Who = "worker", extra: object = {}) => api(who, "POST", `/stock-units/${id}/relocate`, { house_id: house, idempotency_key: uuid(), ...extra });
const v = bound.vacc, dr = bound.drug, ht = bound.heater;
check("vial -> house A is an ALLOCATION", (await reloc(v[0]!, houseA.id)).data?.type === "ALLOCATION");
check("vial 2 -> house A", (await reloc(v[1]!, houseA.id)).status === 200);
check("vial 2 house A -> house B is a REALLOCATION", (await reloc(v[1]!, houseB.id)).data?.type === "REALLOCATION");
check("vial 2 house B -> warehouse is a RETURN", (await reloc(v[1]!, null)).data?.type === "RETURN");
probe("relocate to where it already is -> 409", await reloc(v[0]!, houseA.id), 409, "no-op move accepted");
probe("relocate unknown unit -> 404", await reloc(uuid(), houseA.id), 404, "unknown unit");
probe("relocate an UNASSIGNED blank code -> 4xx", await reloc(pool[pool.length - 1]!, houseA.id), [400, 409], "a blank code with no lot was moved into a house and now has a location");
const idemKey = uuid();
await reloc(v[2]!, houseA.id, "worker", { idempotency_key: idemKey });
probe("replayed relocation key is refused", await reloc(v[2]!, houseB.id, "worker", { idempotency_key: idemKey }), 409, "replay not deduplicated");
for (const id of [dr[0]!, ht[0]!, ht[1]!]) await reloc(id, houseA.id);
const alloc = (await api("admin", "GET", `/stock-house-allocations?house_id=${houseA.id}&limit=100`)).data ?? [];
check("allocation log lists house A moves", alloc.length >= 5, `${alloc.length}`);
check("allocation filter by type=RETURN", ((await api("admin", "GET", "/stock-house-allocations?type=RETURN&limit=100")).data ?? []).every((a: any) => a.type === "RETURN"));
const sumry = (await api("admin", "GET", `/stock-house-allocations/summary?house_id=${houseA.id}&today_from=${ago(1).toISOString()}&week_from=${ago(7).toISOString()}`)).data;
check("allocation summary counts today's moves", sumry?.total >= 5 && sumry?.today >= 5, JSON.stringify(sumry));
const coded = (await api("admin", "GET", `/houses/${houseA.id}/coded-stock`)).data ?? [];
check("house coded-stock lists vaccine, antibiotic, heater", ["INV Newcastle Vaccine", "INV Antibiotic", "INV Brooder Heater"].every((n) => coded.some((c: any) => c.item_name === n)), JSON.stringify(coded.map((c: any) => [c.item_name, c.units, c.quantity])));
// aggregate transfers
const xfer = async (item: string, from: [string, string], to: [string, string], qty: number, unit = "KG", who: Who = "admin", extra: object = {}) =>
    api(who, "POST", "/stock-transfers", { item_id: item, from_location_type: from[0], from_location_id: from[1], to_location_type: to[0], to_location_id: to[1], quantity: qty, unit, ...extra });
const W1: [string, string] = ["WAREHOUSE", wh1.id], W2: [string, string] = ["WAREHOUSE", wh2!.id], A: [string, string] = ["HOUSE", houseA.id], B: [string, string] = ["HOUSE", houseB.id];
async function move(name: string, item: string, from: [string, string], to: [string, string], qty: number, unit = "KG") {
    const r = await xfer(item, from, to, qty, unit);
    check(name, r.status === 201, `${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);
    if (r.status === 201) { mv(item, from[0], from[1], -qty); mv(item, to[0], to[1], qty); }
    return r;
}
await move("warehouse -> house A: 300 kg feed", it.feed, W1, A, 300);
await move("annex -> house A: 200 kg feed", it.feed, W2, A, 200);
await move("house A -> house B: 50 kg feed", it.feed, A, B, 50);
await move("house B -> warehouse (return): 20 kg feed", it.feed, B, W1, 20);
await move("premix to house A: 4 kg", it.premix, W1, A, 4);
probe("transfer more than the source holds -> 409", await xfer(it.feed, B, A, 999), 409, "overdraw accepted");
probe("transfer to the same place -> 409", await xfer(it.feed, A, A, 1), 409, "self transfer accepted");
probe("warehouse -> warehouse -> 400", await xfer(it.feed, W1, W2, 1), 400, "warehouse-to-warehouse accepted");
probe("transfer in BAG (purchasable, not usable) -> 400", await xfer(it.feed, W1, A, 1, "BAG"), 400, "purchase-only unit accepted for use");
probe("transfer to an unknown house -> 404", await xfer(it.feed, W1, ["HOUSE", uuid()], 1), 404, "unknown house accepted");
probe("transfer from an unknown warehouse -> 404", await xfer(it.feed, ["WAREHOUSE", uuid()], A, 1), 404, "unknown warehouse accepted");
probe("worker cannot move warehouse stock -> 403", await xfer(it.feed, W1, A, 1, "KG", "worker"), 403, "worker allowed to transfer");
probe("transfer of a never-stocked item -> 409", await xfer(it.spare, W1, A, 1, "PCS"), 409, "phantom stock moved");
const key1 = uuid();
const t1 = await xfer(it.feed, W1, A, 10, "KG", "admin", { idempotency_key: key1 });
if (t1.status === 201) { mv(it.feed, "WAREHOUSE", wh1.id, -10); mv(it.feed, "HOUSE", houseA.id, 10); }
probe("replayed transfer key -> 409 (no double move)", await xfer(it.feed, W1, A, 10, "KG", "admin", { idempotency_key: key1 }), 409, "replay moved stock twice");
// a coded item moved in aggregate and linked to its unit move
const tv = await xfer(it.vacc, W1, A, 5000, "DOSE");
if (tv.status === 201) { mv(it.vacc, "WAREHOUSE", wh1.id, -5000); mv(it.vacc, "HOUSE", houseA.id, 5000); }
const linked = await reloc(v[3]!, houseA.id, "worker", { stock_transfer_id: tv.data?.id });
check("unit move linked to its aggregate transfer", linked.status === 200 && linked.data?.stock_transfer_id === tv.data?.id, `${linked.status}`);
probe("link a unit to another item's transfer -> 400", await reloc(dr[1]!, houseA.id, "worker", { stock_transfer_id: tv.data?.id }), 400, "wrong-item transfer link accepted");

// ═══ 5. consumption ═════════════════════════════════════════════════════════
section = "5 consumption";
const use = (who: Who, item: string, house: string, qty: number, unit: string, extra: object = {}) =>
    api(who, "POST", "/consumptions", { batch_id: batch.id, house_id: house, item_id: item, quantity: qty, unit, date: ago(0, 9), ...extra });
async function eat(name: string, item: string, house: string, qty: number, unit: string, base: number, extra: object = {}) {
    const r = await use("worker", item, house, qty, unit, extra);
    check(name, r.status === 201, `${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);
    if (r.status === 201) mv(item, (extra as any).stock_unit_id ? null : "HOUSE", (extra as any).stock_unit_id ? null : house, -base);
    return r;
}
await eat("feed 100 kg at house A (batch-linked)", it.feed, houseA.id, 100, "KG", 100);
await eat("premix 500 G -> 0.5 kg (derived usable unit)", it.premix, houseA.id, 500, "G", 0.5);
const noBatch = await api("worker", "POST", "/consumptions", { house_id: houseA.id, item_id: it.feed, quantity: 10, unit: "KG", date: ago(0, 9) });
check("house-level feed with no batch is allowed", noBatch.status === 201);
if (noBatch.status === 201) mv(it.feed, "HOUSE", houseA.id, -10);
probe("feed beyond the house balance -> 409", await use("worker", it.feed, houseA.id, 9999, "KG"), 409, "overdraw accepted");
probe("feed from a house that never got any -> 409", await use("worker", it.feed, houseB.id, 100, "KG"), 409, "consumption from an empty house");
probe("BAG is not a usable unit -> 400", await use("worker", it.feed, houseA.id, 1, "BAG"), 400, "purchase-only unit accepted");
probe("ML on a KG item -> 400", await use("worker", it.feed, houseA.id, 1, "ML"), 400, "wrong-family unit accepted");
probe("zero quantity -> 400", await use("worker", it.feed, houseA.id, 0, "KG"), 400, "zero accepted");
probe("unknown item -> 400", await use("worker", uuid(), houseA.id, 1, "KG"), 400, "unknown item accepted");
const ckey = uuid();
await eat("keyed consumption 5 kg", it.feed, houseA.id, 5, "KG", 5, { idempotency_key: ckey });
probe("replayed consumption key -> 409", await use("worker", it.feed, houseA.id, 5, "KG", { idempotency_key: ckey }), 409, "replay consumed twice");
// coded
await eat("vaccine: 4,000 doses from vial 1 (in house A)", it.vacc, houseA.id, 4000, "DOSE", 4000, { stock_unit_id: v[0] });
check("vial flips IN_STOCK -> IN_USE on first draw", (await prisma.stockUnit.findUniqueOrThrow({ where: { id: v[0]! } })).status === "IN_USE");
await eat("same vial again (it is IN_USE)", it.vacc, houseA.id, 500, "DOSE", 500, { stock_unit_id: v[0] });
probe("draw from a vial that is at the warehouse -> 409", await use("worker", it.vacc, houseA.id, 100, "DOSE", { stock_unit_id: v[1] }), 409, "draw from a unit not in the house");
probe("draw from a vial in another house -> 409", await use("worker", it.vacc, houseB.id, 100, "DOSE", { stock_unit_id: v[0] }), 409, "draw from the wrong house");
probe("unit of a different item -> 400", await use("worker", it.vacc, houseA.id, 100, "DOSE", { stock_unit_id: dr[0] }), 400, "wrong-item unit accepted");
probe("unknown unit -> 404", await use("worker", it.vacc, houseA.id, 1, "DOSE", { stock_unit_id: uuid() }), 404, "unknown unit");
await eat("antibiotic 300 ML (usable derived unit) from bottle", it.drug, houseA.id, 300, "ML", 0.3, { stock_unit_id: dr[0] });
// the lot is 3 L / 3 bottles = 1 L a bottle; nothing stops a draw that is far bigger than the bottle or the lot
const big = await use("worker", it.drug, houseA.id, 50000, "ML", { stock_unit_id: dr[0] });
if (big.status === 201) {
    mv(it.drug, null, null, -50);
    finding("BUG", "A coded draw has no size check: 50,000 ML (50 L) was drawn from one 1 L bottle of a 3 L lot and the system accepted it. The ledger now holds a negative balance for the item (see section 12). StockUnit has no remaining quantity, so only the aggregate path can overdraw-check.");
}
check("coded draw larger than the bottle/lot is refused", big.status >= 400, `status ${big.status}`);
const ceq = await use("worker", it.heater, houseA.id, 1, "UNIT", { stock_unit_id: ht[0] });
check("equipment draw (1 unit, non-depleting)", ceq.status === 201);
// equipment is non-depleting: a draw records usage and moves no stock
check("equipment draw posts no ledger OUT", (await prisma.stockLedger.count({ where: { ref_type: "CONSUMPTION", ref_id: ceq.data?.id } })) === 0);
const csum = (await api("admin", "GET", `/consumptions/summary?house_id=${houseA.id}&today_from=${ago(1).toISOString()}&week_from=${ago(7).toISOString()}`)).data;
check("consumption summary counts today's draws", csum?.today >= 8, JSON.stringify(csum));
check("consumption list filters by item", ((await api("admin", "GET", `/consumptions?item_id=${it.feed}&limit=100`)).data ?? []).every((c: any) => c.item_id === it.feed));

// ═══ 6. adjustments ═════════════════════════════════════════════════════════
section = "6 adjustments";
const adj = (who: Who, item: string, loc: { warehouse_id?: string; house_id?: string }, after: number, reason: string, extra: object = {}) =>
    api(who, "POST", "/inventory-adjustments", { item_id: item, ...loc, quantity_after: after, reason, ...extra });
const fw = bal(it.feed, "WAREHOUSE", wh1.id);
const a1 = await adj("manager", it.feed, { warehouse_id: wh1.id }, fw - 30, "Damaged stock", { quantity_before: 999999 });
check("count correction down: server reads the real balance, ignores the client's quantity_before", a1.status === 201 && Number(a1.data?.quantity_before) === fw && Number(a1.data?.adjustment_quantity) === -30, `${a1.status} before=${a1.data?.quantity_before}`);
if (a1.status === 201) mv(it.feed, "WAREHOUSE", wh1.id, -30);
const a2 = await adj("manager", it.feed, { warehouse_id: wh1.id }, bal(it.feed, "WAREHOUSE", wh1.id) + 12, "Recount");
if (a2.status === 201) mv(it.feed, "WAREHOUSE", wh1.id, 12);
check("count correction up", a2.status === 201);
const a3 = await adj("manager", it.feed, { house_id: houseA.id }, bal(it.feed, "HOUSE", houseA.id) - 8, "Wastage", { note: "spilled bags" });
if (a3.status === 201) mv(it.feed, "HOUSE", houseA.id, -8);
check("house adjustment with reason Wastage", a3.status === 201);
check("Wastage adjustment posts ledger reason WASTAGE", (await prisma.stockLedger.count({ where: { ref_type: "ADJUSTMENT", ref_id: a3.data?.id, reason: "WASTAGE" } })) === 1);
const a4 = await adj("manager", it.premix, { warehouse_id: wh1.id }, bal(it.premix, "WAREHOUSE", wh1.id) - 1, "Expired");
if (a4.status === 201) mv(it.premix, "WAREHOUSE", wh1.id, -1);
check("Expired adjustment posts ledger reason EXPIRED", (await prisma.stockLedger.count({ where: { ref_type: "ADJUSTMENT", ref_id: a4.data?.id, reason: "EXPIRED" } })) === 1);
const a5 = await adj("admin", it.premix, { warehouse_id: wh2!.id }, 6, "Opening balance");
if (a5.status === 201) mv(it.premix, "WAREHOUSE", wh2!.id, 6);
check("opening balance on an empty location", a5.status === 201 && (await prisma.stockLedger.count({ where: { ref_id: a5.data?.id, reason: "OPENING_BALANCE" } })) === 1);
probe("opening balance where stock exists -> 409", await adj("admin", it.feed, { warehouse_id: wh1.id }, 5, "Opening balance"), 409, "opening balance silently became a correction");
probe("count equal to the balance -> 400", await adj("admin", it.feed, { warehouse_id: wh1.id }, bal(it.feed, "WAREHOUSE", wh1.id), "Recount"), 400, "no-op adjustment recorded");
probe("negative count -> 400", await adj("admin", it.feed, { warehouse_id: wh1.id }, -5, "Recount"), 400, "negative stock count accepted");
probe("no location -> 400", await adj("admin", it.feed, {}, 5, "Recount"), 400, "location-less adjustment accepted");
probe("unknown item -> 4xx", await adj("admin", uuid(), { warehouse_id: wh1.id }, 5, "Recount"), [400, 404], "unknown item adjusted");
probe("unknown warehouse -> 4xx", await adj("admin", it.feed, { warehouse_id: uuid() }, 5, "Recount"), [400, 404], "ghost warehouse adjusted (ledger row at a place that does not exist)");
probe("worker cannot adjust stock -> 403", await adj("worker", it.feed, { warehouse_id: wh1.id }, 5, "Recount"), 403, "worker allowed to adjust");
const akey = uuid();
const ar = await adj("manager", it.feed, { warehouse_id: wh1.id }, bal(it.feed, "WAREHOUSE", wh1.id) + 4, "Recount", { idempotency_key: akey });
if (ar.status === 201) mv(it.feed, "WAREHOUSE", wh1.id, 4);
probe("replayed adjustment key is refused", await adj("manager", it.feed, { warehouse_id: wh1.id }, bal(it.feed, "WAREHOUSE", wh1.id) + 4, "Recount", { idempotency_key: akey }), [409, 400], "replay applied twice");
// adjusting a QR-coded item's warehouse count
const av = await adj("manager", it.vacc, { warehouse_id: wh1.id }, bal(it.vacc, "WAREHOUSE", wh1.id) - 1000, "Wastage");
if (av.status === 201) mv(it.vacc, "WAREHOUSE", wh1.id, -1000);
check("adjusting a QR-coded item's warehouse count works", av.status === 201);
check("adjustment list filters by item", ((await api("admin", "GET", `/inventory-adjustments?item_id=${it.feed}`)).data ?? []).length >= 4);

// ═══ 7. disposal + unit lifecycle ═══════════════════════════════════════════
section = "7 disposal";
const before = await prisma.stockLedger.count({ where: { item_id: it.vacc } });
const bv = itemTotal(it.vacc);
const d1 = await api("admin", "POST", `/stock-units/${v[3]}/dispose`);
check("dispose a vial", d1.status === 200 && d1.data?.status === "DISPOSED", `${d1.status}`);
const wo = await prisma.stockLedger.findFirst({ where: { ref_id: v[3]!, location_type: "DISPOSAL" } });
check("disposal writes off the vial's 5,000 doses as WASTAGE at DISPOSAL", wo?.direction === "OUT" && wo.reason === "WASTAGE" && Number(wo.quantity) === 5000, `${wo?.reason} ${wo?.quantity}`);
if (wo) mv(it.vacc, "DISPOSAL", null, -Number(wo.quantity));
probe("dispose twice -> 409", await api("admin", "POST", `/stock-units/${v[3]}/dispose`), 409, "double disposal");
probe("draw from a disposed vial -> 409", await use("worker", it.vacc, houseA.id, 10, "DOSE", { stock_unit_id: v[3] }), 409, "disposed unit consumed");
const afterCount = await prisma.stockLedger.count({ where: { item_id: it.vacc } });
if (afterCount === before) {
    finding("BUG", "Disposing a QR-coded unit posts nothing to the stock ledger. The ledger still counts the disposed vial's doses as on hand, so stock balance, low-stock alerts and stock value all stay too high, and the wastage report never sees it. (ledger location type DISPOSAL exists in the schema but nothing writes it.)");
}
check("disposal reduces item stock (ledger OUT/WASTAGE/DISPOSAL row written)", afterCount > before, `ledger rows ${before} -> ${afterCount}`);
const cons = await api("admin", "PATCH", `/stock-units/${v[2]}/status`, { status: "CONSUMED" });
const wo2 = await prisma.stockLedger.findFirst({ where: { ref_id: v[2]!, location_type: "DISPOSAL" } });
check("marking a vial CONSUMED writes off its unused remainder", cons.status === 200 && Number(wo2?.quantity) === 5000, `${cons.status} ${wo2?.quantity}`);
if (wo2) mv(it.vacc, "DISPOSAL", null, -Number(wo2.quantity));
probe("a CONSUMED unit can't go back to IN_STOCK -> 409", await api("admin", "PATCH", `/stock-units/${v[2]}/status`, { status: "IN_STOCK" }), 409, "used-up unit reopened");
probe("draw from a CONSUMED vial -> 409", await use("worker", it.vacc, houseA.id, 10, "DOSE", { stock_unit_id: v[2] }), 409, "consumed unit drawn again");
const reDisposed = await reloc(v[3]!, houseB.id);
probe("relocate a DISPOSED unit -> 4xx", reDisposed, [400, 409], "a disposed vial can still be moved into a house");
probe("DISPOSED is final: back to IN_STOCK -> 409", await api("admin", "PATCH", `/stock-units/${v[3]}/status`, { status: "IN_STOCK" }), 409, "disposed unit revived with no trail");
probe("UNASSIGNED can't be set by hand -> 400", await api("admin", "PATCH", `/stock-units/${v[0]}/status`, { status: "UNASSIGNED" }), 400, "bound unit un-bound by a status pick");
await api("admin", "POST", `/stock-units/${v[3]}/dispose`);
check("consumed-from unit can't be hard-deleted -> 409", (await api("admin", "DELETE", `/stock-units/${v[0]}`)).status === 409);
const spareUnit = pool.shift()!;
check("a blank code can be deleted", [200, 204].includes((await api("admin", "DELETE", `/stock-units/${spareUnit}`)).status));
const mistake = bound.heater2[1]!;
check("a bound but never-used unit can be deleted", [200, 204].includes((await api("admin", "DELETE", `/stock-units/${mistake}`)).status));
const lotAfter = await prisma.purchaseItem.findUniqueOrThrow({ where: { id: heaterLot2 } });
check("deleting a bound unit leaves the lot's unit_count alone (lot now 1 of 2 linked)", lotAfter.unit_count === 2 && (await prisma.stockUnit.count({ where: { purchase_item_id: heaterLot2 } })) === 1);
// a code deleted by mistake: the bottle still exists, so its slot is refilled by binding a fresh code
const [fresh] = (await must("admin", "POST", "/stock-units", { count: 1 }, "replacement code")) ?? [];
probe("bind a replacement code into the freed slot", await bind(fresh?.id, heaterLot2), 200, "freed lot slot could not be refilled");
check("lot is whole again (2 of 2 linked)", (await prisma.stockUnit.count({ where: { purchase_item_id: heaterLot2 } })) === 2);

// ═══ 8. assets + depreciation ═══════════════════════════════════════════════
section = "8 assets";
const mkAsset = (unit: string, name: string, cost = 2500, life = 5) => api("admin", "POST", "/assets", { stock_unit_id: unit, name, purchase_cost: cost, purchase_date: ago(14), useful_life_batches: life });
const as1 = await mkAsset(ht[0]!, "Heater #1");
check("asset registered on a heater unit", as1.status === 201 && as1.data?.status === "ACTIVE", `${as1.status}`);
probe("second asset on the same unit -> 409", await mkAsset(ht[0]!, "dup"), 409, "one unit became two assets");
probe("asset on an unknown unit -> 4xx", await mkAsset(uuid(), "ghost"), [400, 404], "asset on a ghost unit");
probe("asset with zero cost -> 400", await mkAsset(ht[1]!, "free", 0), 400, "zero-cost asset accepted");
const as2 = await mkAsset(ht[1]!, "Heater #2");
const as3 = await mkAsset(ht[2]!, "Heater #3 (to be mistaken)");
probe("retire an asset", await api("admin", "PATCH", `/assets/${as2.data?.id}/status`, { status: "RETIRED" }), 200, "retire failed");
probe("delete a never-depreciated asset", await api("admin", "DELETE", `/assets/${as3.data?.id}`), [200, 204], "mis-created asset could not be removed");
check("unit with a linked asset can't be hard-deleted -> 409", (await api("admin", "DELETE", `/stock-units/${ht[0]}`)).status === 409);
// a throwaway batch so the heaters can depreciate: both heaters are used, one asset ACTIVE, one RETIRED
const demo = await must("admin", "POST", "/batches", { batch_code: "INV-ASSET-DEMO", breed: "CLASSIC", expected_selling_date: new Date(Date.now() + 40 * 86_400_000), initial_chick_count: 50, init_chicks_avg_wt: 40, house_id: houseB.id }, "demo batch");
await reloc(ht[0]!, houseB.id); await reloc(ht[1]!, houseB.id);
for (const u of [ht[0]!, ht[1]!]) {
    const r = await api("worker", "POST", "/consumptions", { batch_id: demo?.id, house_id: houseB.id, item_id: it.heater, quantity: 1, unit: "UNIT", stock_unit_id: u, date: ago(0, 9) });
    check("heater drawn for the demo batch", r.status === 201, `${r.status}`);
}
const closed = await must("admin", "POST", `/batches/${demo?.id}/close`, { status: "CLOSED", force: true }, "close demo batch");
check("demo batch force-closed", closed?.status === "CLOSED");
const deps = await prisma.assetDepreciation.findMany({ where: { batch_id: demo?.id } });
check("only the ACTIVE asset depreciates: 2500 / 5 batches = 500", deps.length === 1 && deps[0]!.asset_id === as1.data?.id && Number(deps[0]!.amount) === 500, JSON.stringify(deps.map((d) => [d.asset_id.slice(0, 6), String(d.amount)])));
check("asset-depreciations list shows it", ((await api("admin", "GET", `/asset-depreciations?batch_id=${demo?.id}`)).data ?? []).length === 1);
probe("delete an asset with depreciation history -> 409", await api("admin", "DELETE", `/assets/${as1.data?.id}`), 409, "cost history deletable");
const pnlDemo = (await api("admin", "GET", `/analytics/batches/${demo?.id}/pnl`)).data;
check("batch P&L carries the depreciation share", Number(pnlDemo?.depreciation_share) === 500, `${pnlDemo?.depreciation_share}`);
await prisma.houses.update({ where: { id: houseB.id }, data: { phase: houseBPhase } });

// ═══ 9. alerts ══════════════════════════════════════════════════════════════
section = "9 alerts";
const low = (await api("admin", "GET", "/items/low-stock")).data ?? [];
check("feed (reorder 50) is not low while stocked", !low.some((i: any) => i.id === it.feed));
await must("admin", "PATCH", `/items/${it.feed}`, { reorder_level: itemTotal(it.feed) + 100 }, "raise reorder level");
check("feed is low once reorder level > balance", ((await api("admin", "GET", "/items/low-stock")).data ?? []).some((i: any) => i.id === it.feed));
let scan = (await api("admin", "POST", "/alerts/scan")).data ?? [];
check("scan raises LOW_STOCK for the feed", scan.some((a: any) => a.related_id === it.feed));
check("scan raises an expiry alert for the vaccine lot expiring in 12 days", scan.some((a: any) => a.related_id === vaccLot && /expires/.test(a.title)), `alerts: ${scan.map((a: any) => a.title).join(" | ").slice(0, 200)}`);
await must("admin", "PATCH", `/items/${it.feed}`, { reorder_level: 5 }, "lower reorder level");
scan = (await api("admin", "POST", "/alerts/scan")).data ?? [];
check("low-stock alert clears when the level is satisfied", !scan.some((a: any) => a.related_id === it.feed));
// a negative balance should be loud
const negItems = [...new Set([...L.keys()].map((k) => k.split("|")[0]!))].filter((i) => itemTotal(i) < 0);
check("a negative item balance is surfaced by a scan (needs a reorder level to be set)", negItems.length === 0 || scan.some((a: any) => negItems.includes(a.related_id)), "the over-drawn antibiotic has no reorder level, so nothing flags its negative balance");
if (negItems.length && !scan.some((a: any) => negItems.includes(a.related_id))) finding("GAP", "A negative item balance (the over-drawn antibiotic) raises no alert unless the item happens to have a reorder level: a negative ledger balance is a data-integrity signal and should alert regardless.");

// ═══ 10. concurrency ════════════════════════════════════════════════════════
section = "10 concurrency";
const have = bal(it.feed, "HOUSE", houseA.id);
const fits = Math.floor(have / 30);
const wave = await Promise.all(Array.from({ length: fits + 6 }, () => use("worker", it.feed, houseA.id, 30, "KG")));
const won = wave.filter((r) => r.status === 201).length;
if (won > 0) mv(it.feed, "HOUSE", houseA.id, -30 * won);
check(`parallel draws of 30 kg against ${have} kg: exactly ${fits} succeed`, won === fits, `${won} won`);
check("no negative feed balance after the race", bal(it.feed, "HOUSE", houseA.id) >= 0);
const whave = bal(it.feed, "WAREHOUSE", wh2!.id);
const tw = await Promise.all(Array.from({ length: 8 }, () => xfer(it.feed, W2, B, Math.floor(whave / 3), "KG")));
const tOk = tw.filter((r) => r.status === 201).length;
if (tOk > 0) { mv(it.feed, "WAREHOUSE", wh2!.id, -Math.floor(whave / 3) * tOk); mv(it.feed, "HOUSE", houseB.id, Math.floor(whave / 3) * tOk); }
check("parallel transfers: only what the annex holds leaves it", tOk === 3, `${tOk} succeeded`);
const extra = (await must("admin", "POST", "/stock-units", { count: 4 }, "provision race codes")) ?? [];
const lotRace = await Promise.all(extra.map((u: any) => bind(u.id, drugLot, 3)));
check("parallel binds on a full lot (3 of 3 already linked): none succeed", lotRace.every((r) => r.status === 409), lotRace.map((r) => r.status).join(","));
const payRace = P2 ? await Promise.all(Array.from({ length: 5 }, () => api("admin", "POST", "/payments", { amount: r2(P2.total / 3), payment_date: ago(0), ref_type: "PURCHASE", ref_id: P2.p.id, from_instrument_id: bank.id }))) : [];
const payOk = payRace.filter((r) => r.status === 201).length;
if (P2) purchases.find((p) => p.id === P2.p.id)!.paid = payOk * r2(P2.total / 3);
check("parallel payments: the purchase is never overpaid", payOk <= 3, `${payOk} accepted of 5 (3 fit)`);

// ═══ 11. item lifecycle ═════════════════════════════════════════════════════
section = "11 item lifecycle";
probe("deactivate an item", await api("admin", "POST", `/items/${it.premix}/deactivate`), 200, "deactivate failed");
probe("consume a deactivated item -> 400", await use("worker", it.premix, houseA.id, 0.1, "KG"), 400, "deactivated item consumed");
probe("transfer a deactivated item -> 400", await xfer(it.premix, W1, A, 0.1), 400, "deactivated item transferred");
const pDeact = await buy("P5-deactivated", supVet.id, wh1.id, [{ item: it.premix, qty: 2, unit: "KG", price: 410 }], 0);
check("a deactivated item can still be purchased", !!pDeact);
check("deactivated items drop out of low-stock", !((await api("admin", "GET", "/items/low-stock")).data ?? []).some((i: any) => i.id === it.premix));
await api("admin", "POST", `/items/${it.premix}/reactivate`);
probe("delete an item with history -> 409", await api("admin", "DELETE", `/items/${it.feed}`), 409, "used item deleted");
probe("delete a never-used item", await api("admin", "DELETE", `/items/${it.spare}`), [200, 204], "unused item could not be deleted");
probe("tracking mode can't change after purchase -> 409", await api("admin", "PATCH", `/items/${it.feed}`, { is_unit_tracked: true }), 409, "feed became QR-tracked after stock was bought");
const house = await api("admin", "POST", `/houses/${houseB.id}/deactivate`);
probe("transfer into a deactivated house -> 4xx", await xfer(it.feed, W1, B, 1), [400, 409], "stock sent to an inactive house");
probe("consume in a deactivated house -> 4xx", await use("worker", it.feed, houseB.id, 1, "KG"), [400, 409], "inactive house consumed stock");
probe("relocate a unit into a deactivated house -> 4xx", await reloc(dr[2]!, houseB.id), [400, 409], "unit moved into an inactive house");
await api("admin", "POST", `/houses/${houseB.id}/reactivate`);
void house;

// ═══ 12. reports + reconciliation ═══════════════════════════════════════════
section = "12 reports";
const simItems = Object.values(it);
const ledger = await prisma.stockLedger.groupBy({ by: ["item_id", "location_type", "location_id", "direction"], where: { item_id: { in: simItems } }, _sum: { quantity: true } });
const dbBal = new Map<string, number>();
for (const g of ledger) { const k = key(g.item_id, g.location_type, g.location_id); dbBal.set(k, r3((dbBal.get(k) ?? 0) + (g.direction === "IN" ? 1 : -1) * Number(g._sum.quantity))); }
const allKeys = new Set([...L.keys(), ...dbBal.keys()]);
let mism = 0;
for (const k of allKeys) { if (r3(L.get(k) ?? 0) !== r3(dbBal.get(k) ?? 0)) { mism++; check(`ledger ${k.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, (m) => m.slice(0, 6))}`, false, `model ${L.get(k) ?? 0} vs db ${dbBal.get(k) ?? 0}`); } }
check(`ledger matches the model at every item/location (${allKeys.size} cells)`, mism === 0);
const negatives = simItems.filter((i) => itemTotal(i) < 0);
check("no item has a negative total balance", negatives.length === 0, negatives.map((i) => `${i.slice(0, 6)}=${itemTotal(i)}`).join(","));
const whStock = (await api("admin", "GET", `/warehouses/${wh1.id}/stock`)).data ?? [];
check("warehouse stock endpoint = model (feed)", Number(whStock.find((s: any) => s.item_id === it.feed)?.balance ?? 0) === r3(bal(it.feed, "WAREHOUSE", wh1.id)), `${whStock.find((s: any) => s.item_id === it.feed)?.balance} vs ${bal(it.feed, "WAREHOUSE", wh1.id)}`);
const byLoc = (await api("admin", "GET", "/items/stock-by-location")).data ?? [];
check("stock-by-location = model (feed at house A)", Number(byLoc.find((s: any) => s.item_id === it.feed && s.location_id === houseA.id)?.balance ?? 0) === r3(bal(it.feed, "HOUSE", houseA.id)));
const hs = (await api("admin", "GET", `/houses/${houseA.id}/stock`)).data ?? [];
check("house stock endpoint = model (feed)", Number(hs.find((s: any) => s.item_id === it.feed)?.balance ?? 0) === r3(bal(it.feed, "HOUSE", houseA.id)));
const lsum = (await api("admin", "GET", "/stock-ledger/summary")).data;
check("ledger summary: loss_30d counts our WASTAGE + EXPIRED rows", lsum?.loss_30d >= 3, JSON.stringify(lsum));
check("ledger list filter reason=WASTAGE", ((await api("admin", "GET", "/stock-ledger?reason=WASTAGE&limit=100")).data ?? []).every((e: any) => e.reason === "WASTAGE"));
// stock value = Σ positive balance x avg purchase cost
const avg = async (item: string) => { const l = await prisma.purchaseItem.findMany({ where: { item_id: item } }); const q = sum(l, (x) => Number(x.base_quantity)); return q ? sum(l, (x) => Number(x.total_price)) / q : 0; };
const cat = (await api("admin", "GET", "/analytics/inventory/stock-value-by-category")).data ?? [];
let expValue = 0;
for (const i of [it.feed, it.vacc]) { const b = itemTotal(i); if (b > 0) expValue += b * (await avg(i)); }
const gotFeed = Number(cat.find((c: any) => c.category === "FEED")?.total ?? 0), gotVacc = Number(cat.find((c: any) => c.category === "VACCINE")?.total ?? 0);
check("stock value FEED/VACCINE is positive-balance x avg cost (includes other tests' items, so >=)", gotFeed + gotVacc >= r2(expValue) - 1, `${gotFeed}+${gotVacc} vs ${r2(expValue)}`);
if (afterCount === before) finding("NOTE", "Stock value counts disposed vials: item balance is a ledger sum and disposal writes no ledger row, so the doses in a disposed vial still carry value.");
const mt = (await api("admin", "GET", "/analytics/inventory/stock-movement-trend?days=30")).data ?? [];
check("stock movement trend has today's bucket", mt.some((m: any) => m.date === new Date().toISOString().slice(0, 10)));
const wst = (await api("admin", "GET", "/analytics/inventory/wastage-by-category?days=30")).data ?? [];
check("wastage report sees the Wastage/Expired adjustments", wst.length > 0, JSON.stringify(wst));
const cbc = (await api("admin", "GET", "/analytics/inventory/consumption-by-category?days=30")).data ?? [];
check("consumption-by-category lists FEED", cbc.some((c: any) => c.category === "FEED"));
// money
const pr = await prisma.purchase.findMany({ where: { invoice_no: { startsWith: "INV-" } } });
let payables = 0;
for (const p of pr) { const paid = Number((await prisma.payment.aggregate({ where: { ref_type: "PURCHASE", ref_id: p.id }, _sum: { amount: true } }))._sum.amount ?? 0); const m = purchases.find((x) => x.id === p.id); check(`purchase ${p.invoice_no}: payments = model`, r2(paid) === r2(m?.paid ?? -1), `${paid} vs ${m?.paid}`); payables += Number(p.total_amount) - paid; }
const fin = (await api("admin", "GET", "/analytics/financial")).data;
check("financial dashboard payables include our open balances", Number(fin?.outstanding_payables) >= r2(payables), `${fin?.outstanding_payables} vs ${r2(payables)}`);
check("every purchase total = its lines' total_price - discount", (await prisma.purchase.findMany({ where: { invoice_no: { startsWith: "INV-" } }, include: { items: true } })).every((p) => { const g = sum(p.items, (i) => Number(i.total_price)); const d = p.discount_type === "FLAT" ? Number(p.discount_value) : p.discount_type === "PERCENT" ? (g * Number(p.discount_value)) / 100 : 0; return r2(g - d) === r2(Number(p.total_amount)); }));

// ── report ──────────────────────────────────────────────────────────────────
const pass = checks.filter((c) => c.pass).length;
const failed = checks.filter((c) => !c.pass);
const L2: string[] = [];
L2.push("# Inventory simulation -- report", "");
L2.push(`Driven through the HTTP API as admin / manager / worker against the running batch \`${batch.batch_code}\`, then audited against the database. Took ${((Date.now() - t0) / 1000).toFixed(0)}s.`, "");
L2.push(`**Checks: ${pass}/${checks.length} passed, ${failed.length} failed.** Findings: ${findings.filter((f) => f.sev === "BUG").length} bugs, ${findings.filter((f) => f.sev === "GAP").length} gaps, ${findings.filter((f) => f.sev === "NOTE").length} notes.`, "");
L2.push("## Findings", "");
for (const f of findings) L2.push(`- **${f.sev}** ${f.text}`);
if (!findings.length) L2.push("- none");
L2.push("", "## By section", "", "| Section | Pass | Fail |", "|---|---|---|");
for (const s of [...new Set(checks.map((c) => c.section))]) L2.push(`| ${s} | ${checks.filter((c) => c.section === s && c.pass).length} | ${checks.filter((c) => c.section === s && !c.pass).length} |`);
L2.push("", "## Failed checks", "");
for (const c of failed) L2.push(`- [${c.section}] ${c.name} ${c.detail}`);
if (!failed.length) L2.push("- none");
L2.push("", "## All checks", "");
for (const c of checks) L2.push(`- ${c.pass ? "PASS" : "**FAIL**"} [${c.section}] ${c.name}${c.pass ? "" : ` -- ${c.detail}`}`);
writeFileSync(new URL("../docs/inventory-sim-report.md", import.meta.url), L2.join("\n") + "\n");
console.log = realLog;
out(`\n${pass}/${checks.length} checks passed, ${failed.length} failed, ${findings.length} findings. Report: docs/inventory-sim-report.md`);
await prisma.$disconnect();
process.exit(0);
