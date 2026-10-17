/**
 * 62-day batch lifecycle simulation, driven through the real HTTP API (in-process, real auth + validators
 * + permissions) and then audited against the database. Backdated to end yesterday.
 *
 *   bun scripts/batch-lifecycle-sim.ts
 *
 * Writes to the dev database and does NOT clean up -- the point is a browsable batch. Run it against a
 * database with no batches (the sim assumes empty SIM item stock). Report: docs/batch-lifecycle-sim-report.md
 */
process.env.RATE_LIMIT_MAX = "10000000";
const realLog = console.log;
console.log = () => {}; // hono's request logger binds console.log when the app is imported
const { app } = await import("../src/App");
const { default: prisma } = await import("../src/lib/db");
const { signSession } = await import("../src/lib/session");
const { writeFileSync } = await import("node:fs");

const out = (s = "") => process.stdout.write(s + "\n");

// ── tiny harness ────────────────────────────────────────────────────────────
type Who = "admin" | "worker" | "manager";
const tokens = {} as Record<Who, string>;
type Res = { status: number; body: any; data: any };

async function api(who: Who | null, method: string, path: string, body?: unknown): Promise<Res> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (who) headers.Authorization = `Bearer ${tokens[who]}`;
    const res = await app.request("/api" + path, {
        method,
        headers,
        ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    let json: any = null;
    try {
        json = JSON.parse(text);
    } catch {}
    return { status: res.status, body: json, data: json?.data };
}

const checks: { name: string; pass: boolean; detail: string }[] = [];
const findings: { sev: "BUG" | "GAP" | "NOTE"; text: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => {
    checks.push({ name, pass, detail });
    if (!pass) out(`  ✗ ${name} ${detail}`);
    return pass;
};
const finding = (sev: "BUG" | "GAP" | "NOTE", text: string) => findings.push({ sev, text });

/** Happy-path call: a non-2xx is a failed check (and the sim carries on without that write). */
async function must(who: Who, method: string, path: string, body?: unknown, label = `${method} ${path}`) {
    let r = await api(who, method, path, body);
    if (r.status === 403 && who !== "admin") {
        finding("GAP", `${who} was refused ${label} (403) -- fell back to admin`);
        r = await api("admin", method, path, body);
    }
    if (r.status >= 300) {
        check(`HTTP ok: ${label}`, false, `-> ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
        return null;
    }
    return r.data;
}

// ── deterministic randomness + domain curves ────────────────────────────────
let seed = 20260816;
const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

const DAYS = 62;
const INITIAL = 5000;
const CHICK_WT = 38;
/** Day 1 = 2026-08-16, day 62 = 2026-10-16 (yesterday); entries are 08:00 farm time unless said. */
const T = (day: number, h = 8, m = 0) => new Date(Date.UTC(2026, 7, 16 + day - 1, h - 6, m));
const ageOf = (day: number) => day - 1;
const weightG = (age: number) => 40 + 1700 * Math.pow(age / 62, 1.6);
const feedG = (age: number) => 10 + 2.05 * age;
function mortalityRate(day: number) {
    const a = ageOf(day);
    if (day >= 29 && day <= 33) return 0.0045; // the CRD outbreak
    if (a < 3) return 0.003;
    if (a < 8) return 0.0016;
    if (a < 22) return 0.0008;
    if (a < 46) return 0.0004;
    return 0.0003;
}
const feedKey = (age: number) => (age <= 14 ? "starter" : age <= 35 ? "grower" : "finisher");

// ── local model (what SHOULD be true; audited against the API/DB) ──────────
const M = {
    alive: { B: 0, G: 0 },
    died: 0,
    sold: 0,
    revenue: 0,
    feedKg: 0,
    whs: {} as Record<string, number>, // warehouse stock by item key
    house: { B: {}, G: {} } as Record<"B" | "G", Record<string, number>>,
    consumed: {} as Record<string, number>,
    purchased: {} as Record<string, number>,
    purchaseTotal: 0,
    chickCost: 0,
    expenses: 0,
    daily: [] as { day: number; alive: number; died: number; feedKg: number; avgG: number | null; note: string }[],
};
const add = (o: Record<string, number>, k: string, v: number) => (o[k] = r2((o[k] ?? 0) + v));

// ── main ────────────────────────────────────────────────────────────────────
const t0 = Date.now();
const admin = await prisma.admins.findFirstOrThrow({ where: { profile: { name: "AFIF ZILANI" } }, include: { profile: true } });
const workerP = await prisma.profiles.findFirstOrThrow({ where: { name: "Test Worker" } });
const managerP = await prisma.profiles.findFirstOrThrow({ where: { name: "Test Manager" } });
for (const [who, p] of [["admin", admin.profile], ["worker", workerP], ["manager", managerP]] as const) {
    tokens[who] = await signSession(p.id, p.password_changed_at, "web");
}
const brooder = await prisma.houses.findFirstOrThrow({ where: { type: "BROODER", number: 1 } });
const grower = await prisma.houses.findFirstOrThrow({ where: { type: "GROWER", number: 1 } });
const H = { B: brooder.id, G: grower.id };
const warehouse = await prisma.warehouses.findFirstOrThrow({ where: { name: "Main Warehouse Kunduna" } });
const cash = await prisma.paymentInstrument.findFirstOrThrow({ where: { label: "Cash", owner_type: "ADMIN" } });
const bank = await prisma.paymentInstrument.findFirstOrThrow({ where: { label: "ZEROD FARMS BANK" } });
out(`Sim: ${DAYS} days, ${INITIAL} chicks, ${brooder.name} -> ${grower.name}`);

const fin0 = (await api("admin", "GET", "/analytics/financial")).data;
check("pre: no batches exist", (await prisma.batches.count()) === 0);
check("pre: houses empty", (await prisma.batchHouseBalance.count({ where: { quantity: { gt: 0 } } })) === 0);
check("auth: no token -> 401", (await api(null, "GET", "/batches")).status === 401);

// ── master data ─────────────────────────────────────────────────────────────
const mk = async (path: string, body: object) => (await must("admin", "POST", path, body))?.id as string;
const sup = {
    hatchA: await mk("/suppliers", { name: "SIM Hatchery A", mobile: "+8801900000001", role: "OWNER", supplies: ["CHICKS"] }),
    hatchB: await mk("/suppliers", { name: "SIM Hatchery B", mobile: "+8801900000002", role: "OWNER", supplies: ["CHICKS"] }),
    mill: await mk("/suppliers", { name: "SIM Feed Mill", mobile: "+8801900000003", role: "DISTRIBUTOR", supplies: ["FEED", "HUSK"] }),
    vet: await mk("/suppliers", { name: "SIM Vet Pharma", mobile: "+8801900000004", role: "DEALER", supplies: ["MEDICINE"] }),
};
const cust = {
    A: await mk("/customers", { name: "SIM Karim Poultry Traders", mobile: "+8801900000011" }),
    B: await mk("/customers", { name: "SIM Rahim Broiler House", mobile: "+8801900000012" }),
    C: await mk("/customers", { name: "SIM Dhaka Live Bird Co", mobile: "+8801900000013" }),
};
const doctor = await mk("/doctors", { name: "Dr. SIM Rahman", mobile: "+8801900000021", specialty: "Poultry" });
const item = async (name: string, category: string, unit: string, tracked = false) =>
    await mk("/items", { name, category, unit, is_unit_tracked: tracked });
const it = {
    chick: await item("SIM Day-old Chick", "CHICKS", "PCS"),
    starter: await item("SIM Starter Feed", "FEED", "KG"),
    grower: await item("SIM Grower Feed", "FEED", "KG"),
    finisher: await item("SIM Finisher Feed", "FEED", "KG"),
    husk: await item("SIM Rice Husk", "HUSK", "KG"),
    vitamin: await item("SIM Vitamin-C Electrolyte", "SUPPLEMENT", "KG"),
    nd: await item("SIM Newcastle (ND) Vaccine", "VACCINE", "DOSE", true),
    ibd: await item("SIM Gumboro (IBD) Vaccine", "VACCINE", "DOSE", true),
    abx: await item("SIM Enrofloxacin Antibiotic", "MEDICINE", "LITER", true),
};
for (const k of ["starter", "grower", "finisher"] as const)
    await must("admin", "POST", "/item-units", { item_id: it[k], unit: "BAG", factor_to_base: 50, is_purchasable: true });

await must("admin", "POST", "/item-units", { item_id: it.abx, unit: "ML", factor_to_base: 0.001, is_purchasable: false, is_usable: true });

// ── purchases ───────────────────────────────────────────────────────────────
type PL = { item: string; qty: number; unit: string; price: number; key?: string; batch?: string };
async function purchase(day: number, supplier: string, lines: PL[], paidPct: number, opts: { discount?: number } = {}) {
    const items = lines.map((l) => ({
        item_id: l.item, quantity: l.qty, unit: l.unit, unit_price: l.price,
        ...(l.batch && { batch_id: l.batch }),
    }));
    const total = lines.reduce((s, l) => s + l.qty * l.price, 0) - (opts.discount ?? 0);
    const paid = r2(total * paidPct);
    const p = await must("admin", "POST", "/purchases", {
        supplier_id: supplier, warehouse_id: warehouse.id, purchase_date: T(day, 7),
        paid_amount: paid, ...(paid > 0 && { paid_from_instrument_id: bank.id }),
        invoice_no: `SIM-INV-${day}-${supplier.slice(0, 4)}`,
        ...(opts.discount && { discount_type: "FLAT", discount_value: opts.discount }),
        items,
    }, `purchase d${day}`);
    if (!p) return null;
    M.purchaseTotal += total;
    for (const l of lines) if (l.key) {
        const base = l.unit === "BAG" ? l.qty * 50 : l.qty;
        add(M.whs, l.key, base);
        add(M.purchased, l.key, base);
    }
    check(`purchase d${day} total = Σlines - discount`, r2(Number(p.total_amount)) === r2(total), `${p.total_amount} vs ${total}`);
    return { purchase: p, total, paid, itemIds: p.items.map((i: any) => i.id as string) };
}
const purchases: { id: string; total: number; paid: number }[] = [];
const rec = (p: Awaited<ReturnType<typeof purchase>>) => p && purchases.push({ id: p.purchase.id, total: p.total, paid: p.paid });

// ── day 1: batch ────────────────────────────────────────────────────────────
const batch = await must("admin", "POST", "/batches", {
    batch_code: "SIM-2026-08-16", breed: "HIBREED", starting_date: T(1, 7),
    expected_selling_date: T(62), initial_chick_count: INITIAL, init_chicks_avg_wt: CHICK_WT, house_id: H.B,
});
if (!batch) {
    out("cannot continue without a batch");
    process.exit(1);
}
const BID: string = batch.id;
M.alive.B = INITIAL;
check("batch created RUNNING with initial balance", batch.status === "RUNNING" && batch.houseBalances[0]?.quantity === INITIAL);

// two chick deliveries: different suppliers, prices, days (batch-management-design §3)
const c1 = await purchase(1, sup.hatchA, [{ item: it.chick, qty: 3000, unit: "PCS", price: 38, batch: BID }], 1);
const c2 = await purchase(2, sup.hatchB, [{ item: it.chick, qty: 2000, unit: "PCS", price: 42, batch: BID }], 0.5);
rec(c1); rec(c2);
M.chickCost = 3000 * 38 + 2000 * 42;

// feeds, bedding, vaccines, meds
rec(await purchase(1, sup.mill, [
    { item: it.starter, qty: 45, unit: "BAG", price: 3100, key: "starter" },
    { item: it.husk, qty: 1500, unit: "KG", price: 12, key: "husk" },
], 0.5));
const vacc = await purchase(1, sup.vet, [
    { item: it.nd, qty: 15000, unit: "DOSE", price: 0.13 },
    { item: it.ibd, qty: 10000, unit: "DOSE", price: 0.16 },
    { item: it.abx, qty: 2, unit: "LITER", price: 1450 },
    { item: it.vitamin, qty: 25, unit: "KG", price: 520, key: "vitamin" },
], 1, { discount: 150 });
rec(vacc);
const lotOf = (p: typeof vacc, i: number) => p!.purchase.items[i].id as string;
// coded lots: QR-bind 3 ND vials (5000 doses each), 2 IBD, 2 antibiotic bottles
const vials = { nd: [] as string[], ibd: [] as string[], abx: [] as string[] };
async function bindUnits(lot: string, n: number, into: string[]) {
    const units = await must("admin", "POST", "/stock-units", { count: n }, "provision QR");
    for (const u of units ?? []) {
        const b = await must("manager", "POST", `/stock-units/${u.id}/bind`, { purchase_item_id: lot, unit_count: n }, "bind QR");
        if (b) into.push(u.id);
    }
}
await bindUnits(lotOf(vacc, 0), 3, vials.nd);
await bindUnits(lotOf(vacc, 1), 2, vials.ibd);
await bindUnits(lotOf(vacc, 2), 2, vials.abx);
check("QR units bound (3 ND, 2 IBD, 2 abx)", vials.nd.length === 3 && vials.ibd.length === 2 && vials.abx.length === 2);

// feeding programme (manager)
const programs = [
    ["STARTER", it.starter, 0, 14], ["GROWER", it.grower, 15, 35], ["FINISHER", it.finisher, 36, undefined],
] as const;
const programIds: string[] = [];
for (const [feed_type, item_id, start_day, end_day] of programs) {
    const p = await must("manager", "POST", "/batch-feeding-programs", { batch_id: BID, feed_type, item_id, start_day, ...(end_day !== undefined && { end_day }) });
    if (p) programIds.push(p.id);
}

// ── helpers that mutate the model only on success ───────────────────────────
const backdate = {
    transfers: [] as { id: string; at: Date }[],
    env: [] as { id: string; at: Date }[],
    alloc: [] as { id: string; at: Date }[],
    relocs: [] as { id: string; at: Date }[],
};

async function stockTransfer(day: number, key: string, itemId: string, to: "B" | "G", kg: number) {
    const t = await must("admin", "POST", "/stock-transfers", {
        item_id: itemId, from_location_type: "WAREHOUSE", from_location_id: warehouse.id,
        to_location_type: "HOUSE", to_location_id: H[to], quantity: kg, unit: "KG", note: `SIM d${day}`,
    }, `transfer ${key} d${day}`);
    if (!t) return false;
    add(M.whs, key, -kg);
    add(M.house[to], key, kg);
    backdate.transfers.push({ id: t.id, at: T(day, 7, 30) });
    return true;
}
async function consume(day: number, who: Who, key: string, itemId: string, to: "B" | "G", qty: number, unit = "KG", extra: object = {}) {
    const c = await must(who, "POST", "/consumptions", {
        batch_id: BID, house_id: H[to], item_id: itemId, quantity: qty, unit, date: T(day, 9), ...extra,
    }, `consume ${key} d${day}`);
    if (c && !(extra as any).stock_unit_id) {
        add(M.house[to], key, -qty);
        add(M.consumed, key, qty);
    }
    return c;
}
const itemId = (k: string) => (it as Record<string, string>)[k]!;

async function feedHouse(day: number, h: "B" | "G") {
    const birds = M.alive[h];
    if (birds <= 0) return 0;
    const key = feedKey(ageOf(day));
    const need = r1((birds * feedG(ageOf(day))) / 1000);
    const have = M.house[h][key] ?? 0;
    if (have < need) {
        const want = Math.ceil((need * 2 - have) / 25) * 25;
        const send = Math.min(want, Math.floor(M.whs[key] ?? 0));
        if (send > 0) await stockTransfer(day, key, itemId(key), h, send);
    }
    const give = Math.min(need, M.house[h][key] ?? 0);
    if (give < need) finding("BUG", `d${day}: ${key} feed short at ${h}: needed ${need} kg, had ${give}`);
    if (give > 0 && (await consume(day, "worker", key, itemId(key), h, give))) {
        M.feedKg = r2(M.feedKg + give);
        return give;
    }
    return 0;
}

async function transferBirds(day: number, qty: number, key: string) {
    const a = await must("manager", "POST", "/batch-house-allocations", {
        batch_id: BID, from_house_id: H.B, to_house_id: H.G, quantity: qty, reason: "TRANSFER", idempotency_key: key,
    }, `birds B->G d${day}`);
    if (!a) return;
    M.alive.B -= qty;
    M.alive.G += qty;
    backdate.alloc.push({ id: a.id, at: T(day, 10) });
}

async function relocateVial(day: number, id: string, to: "B" | "G") {
    const r = await must("worker", "POST", `/stock-units/${id}/relocate`, { house_id: H[to], idempotency_key: `sim-reloc-${id}-${to}` }, "relocate vial");
    if (r) backdate.relocs.push({ id: r.id, at: T(day, 7, 45) });
}
async function vaccinate(day: number, name: string, itemKey: "nd" | "ibd", vialId: string, note: string) {
    const h: "B" | "G" = M.alive.G > 0 && M.alive.B === 0 ? "G" : "B";
    const birds = M.alive.B + M.alive.G;
    // sanity: all birds are together on every vaccination day in this schedule
    if (M.alive.B > 0 && M.alive.G > 0) finding("NOTE", `d${day}: ${name} given while birds split across houses`);
    await relocateVial(day, vialId, h);
    const c = await consume(day, "worker", itemKey, itemId(itemKey), h, birds, "DOSE", { stock_unit_id: vialId, note });
    const v = await must("worker", "POST", "/vaccinations", {
        batch_id: BID, consumption_id: c?.id, vaccine_name: name, dosage: birds, cause: "Routine schedule",
        period: `Day ${ageOf(day)}`, doctor_id: doctor, remarks: note, date: T(day, 9),
    }, `vaccination d${day}`);
    if (v) await must("admin", "PATCH", `/stock-units/${vialId}/status`, { status: "CONSUMED" }, "vial consumed");
    return v;
}

async function doseMed(day: number, key: "abx" | "vitamin", name: string, qty: number, unit: string, vialId?: string) {
    const h: "B" | "G" = M.alive.G > 0 && M.alive.B === 0 ? "G" : "B";
    if (vialId && day === 30) await relocateVial(day, vialId, h);
    if (key === "vitamin") {
        const have = M.house[h].vitamin ?? 0;
        if (have < qty) await stockTransfer(day, "vitamin", it.vitamin, h, 3);
    }
    const c = await consume(day, "worker", key, itemId(key), h, qty, unit, vialId ? { stock_unit_id: vialId } : {});
    await must("worker", "POST", "/medications", {
        batch_id: BID, consumption_id: c?.id, medicine_name: name, dosage: `${qty} ${unit}`,
        cause: key === "abx" ? "Respiratory (suspected CRD)" : "Anti-stress / electrolyte", period: `Day ${ageOf(day)}`,
        ...(key === "abx" && { doctor_id: doctor }), date: T(day, 9),
    }, `medication ${name} d${day}`);
}

async function expense(day: number, category: string, amount: number, remarks: string) {
    const e = await must("admin", "POST", "/expenses", { batch_id: BID, category, cost_type: "DIRECT", amount, date: T(day, 12), remarks }, `expense ${category} d${day}`);
    if (!e) return;
    M.expenses += amount;
    await must("admin", "POST", "/payments", { amount, payment_date: T(day, 12), ref_type: "EXPENSE", ref_id: e.id, from_instrument_id: bank.id }, "pay expense");
}

// ── daily loop ──────────────────────────────────────────────────────────────
const weighDays = new Set([8, 15, 22, 29, 36, 43, 50, 57, 62]);
const mortalityIds: string[] = [];
const saleIds: string[] = [];
let lastAvgG: number | null = null;
let keyReplayDone = false;

for (let day = 1; day <= DAYS; day++) {
    const age = ageOf(day);
    const notes: string[] = [];
    const diedBefore = M.died;
    const feedBefore = M.feedKg;

    // morning logistics: bulk feed arrivals
    if (day === 14) rec(await purchase(day, sup.mill, [{ item: it.grower, qty: 140, unit: "BAG", price: 2900, key: "grower" }], 0.5));
    if (day === 34) rec(await purchase(day, sup.mill, [{ item: it.finisher, qty: 100, unit: "BAG", price: 2750, key: "finisher" }], 0.5));
    if (day === 46) rec(await purchase(day, sup.mill, [{ item: it.finisher, qty: 150, unit: "BAG", price: 2800, key: "finisher" }], 0));

    // day 1: litter + chick-guard supplements into the brooder
    if (day === 1) {
        await stockTransfer(day, "husk", it.husk, "B", 1500);
        await consume(day, "worker", "husk", it.husk, "B", 1500);
        notes.push("litter laid");
    }
    if (day <= 3) await doseMed(day, "vitamin", "Vitamin-C + Electrolyte", 0.5, "KG");

    // weighing happens before any move so the brooder sample is the pre-move flock
    if (weighDays.has(day)) {
        for (const h of ["B", "G"] as const) {
            if (M.alive[h] <= 0) continue;
            const avg = r2(weightG(age) * (1 + 0.03 * gauss()));
            const w = await must("worker", "POST", "/weight-records", { batch_id: BID, house_id: H[h], average_wt_grams: avg, sample_size: 40, date: T(day, 8) }, `weight d${day}`);
            if (w) lastAvgG = avg;
        }
    }

    // brooder -> grower, staggered over two days (60% then the rest)
    if (day === 15) {
        await transferBirds(day, Math.round(M.alive.B * 0.6), "sim-move-d15");
        notes.push("60% moved to grower");
    }
    if (day === 16) {
        const rest = M.alive.B;
        await transferBirds(day, rest, "sim-move-d16");
        notes.push("rest moved; brooder emptied");
        const bh = await prisma.houses.findUniqueOrThrow({ where: { id: H.B } });
        check("brooder auto-CLEANING once emptied", bh.phase === "CLEANING", `phase=${bh.phase}`);
        const up = await must("admin", "PATCH", `/batches/${BID}`, { phase: "GROWER" });
        check("batch phase -> GROWER", up?.phase === "GROWER");
    }

    // vaccination schedule
    if (day === 5) await vaccinate(day, "Newcastle B1 (eye drop)", "nd", vials.nd[0]!, "ND B1"), notes.push("ND B1");
    if (day === 11) await vaccinate(day, "Gumboro IBD", "ibd", vials.ibd[0]!, "IBD 1"), notes.push("IBD 1");
    if (day === 18) await vaccinate(day, "Gumboro IBD booster", "ibd", vials.ibd[1]!, "IBD booster"), notes.push("IBD booster");
    if (day === 22) await vaccinate(day, "Newcastle Lasota", "nd", vials.nd[1]!, "ND Lasota"), notes.push("ND Lasota");
    if (day === 36) await vaccinate(day, "Newcastle booster", "nd", vials.nd[2]!, "ND booster"), notes.push("ND booster");

    // CRD outbreak treatment: day 30-34 antibiotic (300 ml/day), electrolyte support day 31-33
    if (day >= 30 && day <= 34) {
        await doseMed(day, "abx", "Enrofloxacin 10%", 300, "ML", vials.abx[0]);
        if (day >= 31 && day <= 33) await doseMed(day, "vitamin", "Vitamin-C + Electrolyte", 0.5, "KG");
        notes.push("antibiotic course");
    }

    // feed, every house with birds
    for (const h of ["B", "G"] as const) await feedHouse(day, h);

    // mortality (worker), split by house share
    const totalAlive = M.alive.B + M.alive.G;
    const mean = totalAlive * mortalityRate(day);
    let deaths = Math.max(0, Math.round(mean + Math.sqrt(mean) * gauss()));
    if (day === 62) deaths = 4;
    const dB = totalAlive > 0 ? Math.min(M.alive.B, Math.round((deaths * M.alive.B) / totalAlive)) : 0;
    const split = { B: dB, G: Math.min(M.alive.G, deaths - dB) };
    for (const h of ["B", "G"] as const) {
        const n = split[h];
        if (n <= 0) continue;
        const key = `sim-mort-d${day}-${h}`;
        const m = await must("worker", "POST", "/mortality-logs", {
            batch_id: BID, house_id: H[h], count_died: n, date: T(day, 17), idempotency_key: key,
            cause_note: day >= 29 && day <= 33 ? "Respiratory distress / CRD" : age < 8 ? "Weak chick / yolk sac" : "Natural",
        }, `mortality d${day}`);
        if (m) {
            M.alive[h] -= n;
            M.died += n;
            mortalityIds.push(m.id);
            if (!keyReplayDone && day === 3) {
                // an offline-sync retry of the same write must not double-count
                keyReplayDone = true;
                const replay = await api("worker", "POST", "/mortality-logs", { batch_id: BID, house_id: H[h], count_died: n, date: T(day, 17), idempotency_key: key });
                check("replayed mortality idempotency_key is rejected", replay.status === 409, `status ${replay.status}`);
                const chk = await prisma.mortalityLog.count({ where: { idempotency_key: key } });
                check("replay did not double-count", chk === 1);
            }
        }
    }

    // environment readings, morning + evening, each occupied house
    for (const h of ["B", "G"] as const) {
        if (M.alive[h] <= 0) continue;
        for (const [period, hr] of [["MORNING", 6], ["EVENING", 18]] as const) {
            const outbreak = day >= 29 && day <= 33;
            const e = await must("worker", "POST", "/environment-records", {
                batch_id: BID, house_id: H[h], time_period: period,
                temperature_c: r1(Math.max(24, 33 - 0.45 * age) + gauss() * 0.6 + (period === "EVENING" ? 1 : 0)),
                humidity_percent: r1(64 + gauss() * 4), ammonia_ppm: r1(4 + 0.3 * age + (outbreak ? 7 : 0) + gauss()),
                co2_ppm: Math.round(1200 + 22 * age + gauss() * 60), air_pressure_hpa: r1(1008 + gauss() * 2),
            }, `env d${day}`);
            if (e) backdate.env.push({ id: e.id, at: T(day, hr) });
        }
    }

    // overheads
    if (day % 7 === 0) await expense(day, "LABOR", 8500, "Weekly shed labour");
    if (day === 10) await expense(day, "MISC", 1800, "Brooder heater repair");
    if (day === 30) await expense(day, "VET_FEE", 2500, "Vet visit - respiratory outbreak");
    if (day === 31) { await expense(day, "ELECTRICITY", 6200, "Month 1 power"); await expense(day, "WATER", 1200, "Month 1 water"); }
    if (day === 45) await expense(day, "FUEL", 4000, "Generator diesel");
    if (day === 61) await expense(day, "ELECTRICITY", 7800, "Month 2 power");

    // supplier settlement + negative probes
    if (day === 20) {
        const c2p = purchases[1]!;
        const due = r2(c2p.total - c2p.paid);
        const ok = await must("admin", "POST", "/payments", { amount: due, payment_date: T(day, 11), ref_type: "PURCHASE", ref_id: c2p.id, from_instrument_id: bank.id });
        if (ok) c2p.paid = c2p.total;
    }
    if (day === 9) {
        const r = await api("worker", "POST", "/mortality-logs", { batch_id: BID, house_id: H.B, count_died: M.alive.B + 1, date: T(day, 17) });
        check("probe: mortality > live birds -> 409", r.status === 409, `status ${r.status}`);
    }
    if (day === 10) {
        const dup = await api("worker", "POST", "/weight-records", { batch_id: BID, house_id: H.B, average_wt_grams: 120, sample_size: 30, date: T(8, 9) });
        check("probe: 2nd weight sample same day -> 409", dup.status === 409, `status ${dup.status}`);
    }
    if (day === 13) {
        const r = await api("worker", "POST", "/consumptions", { batch_id: BID, house_id: H.B, item_id: it.starter, quantity: 99999, unit: "KG", date: T(day, 9) });
        check("probe: feed beyond house stock -> 409", r.status === 409, `status ${r.status}`);
    }
    if (day === 17) {
        const r = await api("manager", "POST", "/batch-house-allocations", { batch_id: BID, from_house_id: H.B, to_house_id: H.G, quantity: 1, reason: "TRANSFER" });
        check("probe: move birds from emptied brooder -> 409", r.status === 409, `status ${r.status}`);
    }
    if (day === 21) {
        const r = await api("worker", "POST", "/batches", { batch_code: "X", breed: "HIBREED", expected_selling_date: T(60), initial_chick_count: 1, init_chicks_avg_wt: 40, house_id: H.B });
        check("probe: worker cannot create a batch -> 403", r.status === 403, `status ${r.status}`);
    }
    if (day === 25) {
        const r = await api("admin", "POST", "/mortality-logs", { batch_id: BID, house_id: H.G, count_died: -3, date: T(day) });
        check("probe: negative count -> 400", r.status === 400, `status ${r.status}`);
    }
    if (day === 40) {
        const r = await api("worker", "POST", "/stock-transfers", { item_id: it.finisher, from_location_type: "WAREHOUSE", from_location_id: warehouse.id, to_location_type: "HOUSE", to_location_id: H.G, quantity: 1, unit: "KG" });
        check("probe: worker cannot move warehouse stock -> 403", r.status === 403, `status ${r.status}`);
    }

    // sales: three truckloads, mixed grades, three customers
    const saleDays: Record<number, { cust: keyof typeof cust; rows: [("HIGH" | "LOW" | "CULL"), number][]; payPct: number; discount?: number }> = {
        58: { cust: "A", rows: [["HIGH", 1350], ["LOW", 100]], payPct: 1, discount: 1500 },
        60: { cust: "B", rows: [["HIGH", 1650], ["LOW", 80], ["CULL", 20]], payPct: 0.8 },
    };
    const spec = day === 62 ? { cust: "C" as const, rows: null, payPct: 0.6 } : saleDays[day];
    if (day === 62) await finishSales(day);
    if (spec && day !== 62) await sellLoad(day, spec.cust, spec.rows, spec.payPct, spec.discount);

    // end-of-day parity: API balances must equal the model
    const b = await api("admin", "GET", `/batches/${BID}`);
    const bal = Object.fromEntries((b.data?.houseBalances ?? []).map((x: any) => [x.house_id, x.quantity]));
    const okB = (bal[H.B] ?? 0) === M.alive.B && (bal[H.G] ?? 0) === M.alive.G;
    check(`day ${day}: house balances match model`, okB, `api B=${bal[H.B] ?? 0} G=${bal[H.G] ?? 0} model B=${M.alive.B} G=${M.alive.G}`);

    M.daily.push({ day, alive: M.alive.B + M.alive.G, died: M.died - diedBefore, feedKg: r2(M.feedKg - feedBefore), avgG: weighDays.has(day) ? lastAvgG : null, note: notes.join("; ") });
    if (day % 10 === 0) out(`  day ${day}/${DAYS}  alive=${M.alive.B + M.alive.G}  died=${M.died}  feed=${M.feedKg}kg  checks failed=${checks.filter((c) => !c.pass).length}`);
}

async function sellLoad(day: number, who: keyof typeof cust, rows: [("HIGH" | "LOW" | "CULL"), number][] | null, payPct: number, discount = 0) {
    const list = rows ?? [];
    const avgG = weightG(ageOf(day));
    const price = { HIGH: 265, LOW: 225, CULL: 160 };
    for (const [i, [grade, birds]] of list.entries()) {
        if (birds > M.alive.G) { finding("BUG", `d${day}: tried to sell ${birds}, only ${M.alive.G} alive`); continue; }
        const net = r2((birds * avgG * 0.985) / 1000);
        const total_weight = r2(net * 1.015);
        const katha = Math.ceil(birds / 12);
        const total = r2(net * price[grade]);
        const disc = i === 0 ? discount : 0;
        const paid = r2((total - disc) * payPct);
        const s = await must("admin", "POST", "/bird-sales", {
            batch_id: BID, house_id: H.G, customer_id: cust[who], sale_date: T(day, 14), grade, birds_count: birds,
            male_count: Math.round(birds * 0.55), female_count: birds - Math.round(birds * 0.55),
            dholta_in_g: 100, total_katha: katha, avg_wt_per_katha_kg: r2(total_weight / katha),
            total_weight, net_weight: net, avg_weight_g: r2((net * 1000) / birds), price_per_kg: price[grade],
            paid_amount: paid, ...(paid > 0 && { paid_to_instrument_id: bank.id }), ...(disc > 0 && { discount_amount: disc }),
        }, `sale ${grade} d${day}`);
        if (!s) continue;
        saleIds.push(s.id);
        M.alive.G -= birds;
        M.sold += birds;
        M.revenue = r2(M.revenue + total);
        check(`sale d${day} ${grade}: total_amount = net x price`, r2(Number(s.total_amount)) === total, `${s.total_amount} vs ${total}`);
        check(`sale d${day} ${grade}: due = total - discount`, r2(Number(s.due_amount)) === r2(total - disc), `${s.due_amount}`);
    }
    await expense(day, "TRANSPORT", 3500, `Loading van - customer ${who}`);
}
async function finishSales(day: number) {
    // final load: everything left, mostly HIGH
    const left = M.alive.G;
    const cull = 15, low = 45;
    await sellLoad(day, "C", [["HIGH", left - cull - low], ["LOW", low], ["CULL", cull]], 0.6);
    // closing without force while birds remain must be refused -- tested one day earlier than the real close
}

// Settle customer B's balance after the fact (a real follow-up payment), leave A fully paid and C owing.
{
    const bSales = await prisma.birdSale.findMany({ where: { customer_id: cust.B } });
    for (const s of bSales) {
        const paidNow = await prisma.payment.aggregate({ where: { ref_type: "BIRD_SALE", ref_id: s.id }, _sum: { amount: true } });
        const owed = Number(s.due_amount) - Number(paidNow._sum.amount ?? 0);
        if (owed > 0.005) await must("admin", "POST", "/payments", { amount: r2(owed), payment_date: T(62, 16), ref_type: "BIRD_SALE", ref_id: s.id, to_instrument_id: bank.id }, "customer settles");
    }
}

// ── close the batch ─────────────────────────────────────────────────────────
check("end: no live birds left", M.alive.B + M.alive.G === 0, `alive=${M.alive.B + M.alive.G}`);
{
    // reopen-style probe on an empty batch is moot; test force/no-force semantics with a throwaway expectations:
    const closed = await must("admin", "POST", `/batches/${BID}/close`, { status: "SOLD" }, "close batch");
    check("batch closes SOLD with zero birds, no force", closed?.status === "SOLD");
    const again = await api("admin", "POST", `/batches/${BID}/close`, { status: "SOLD" });
    check("probe: closing twice -> 409", again.status === 409, `status ${again.status}`);
    const edit = await api("admin", "PATCH", `/batches/${BID}`, { phase: "BROODER" });
    check("probe: editing a closed batch -> 409", edit.status === 409, `status ${edit.status}`);
    const late = await api("worker", "POST", "/mortality-logs", { batch_id: BID, house_id: H.G, count_died: 1, date: T(62, 18) });
    check("probe: mortality on a closed batch is refused", late.status >= 400, `status ${late.status} (live birds = 0 so the balance guard stops it)`);
}

// ── make backdated rows look like the days they happened ────────────────────
for (const x of backdate.env) await prisma.environmentRecords.update({ where: { id: x.id }, data: { recorded_at: x.at } });
for (const x of backdate.alloc) await prisma.batchHouseAllocation.update({ where: { id: x.id }, data: { occurred_at: x.at } });
await prisma.batchHouseAllocation.updateMany({ where: { batch_id: BID, reason: "INITIAL" }, data: { occurred_at: T(1, 7) } });
for (const x of backdate.relocs) await prisma.stockHouseAllocation.update({ where: { id: x.id }, data: { occurred_at: x.at } });
for (const x of backdate.transfers) {
    await prisma.stockTransfer.update({ where: { id: x.id }, data: { created_at: x.at } });
    await prisma.stockLedger.updateMany({ where: { ref_type: "TRANSFER", ref_id: x.id }, data: { occurred_at: x.at } });
}
for (const c of await prisma.consumption.findMany({ where: { batch_id: BID }, select: { id: true, date: true } }))
    await prisma.stockLedger.updateMany({ where: { ref_type: "CONSUMPTION", ref_id: c.id }, data: { occurred_at: c.date } });
for (const pi of await prisma.purchaseItem.findMany({ where: { purchase: { invoice_no: { startsWith: "SIM-INV" } } }, include: { purchase: true } }))
    await prisma.stockLedger.updateMany({ where: { ref_type: "PURCHASE", ref_id: pi.id }, data: { occurred_at: pi.purchase.purchase_date } });
finding("NOTE", "Item categories include VACCINE and SUPPLEMENT but supplier supply categories do not (FEED, MEDICINE, CHICKS, HUSK, ... only), so a vaccine/vitamin distributor can only be tagged MEDICINE.");
finding("GAP", "Environment records, house allocations (incl. the INITIAL one), QR relocations and stock transfers have no client-settable timestamp (they stamp now()). Entries synced late from the offline mobile app would carry the sync time, not the time of the event. This sim back-dated them in SQL after the fact.");

// ── audit against the DB ────────────────────────────────────────────────────
const sum = (xs: any[], f: (x: any) => number) => xs.reduce((s, x) => s + f(x), 0);
const bRow = await prisma.batches.findUniqueOrThrow({ where: { id: BID }, include: { houseBalances: true } });
const mort = await prisma.mortalityLog.findMany({ where: { batch_id: BID } });
const sales = await prisma.birdSale.findMany({ where: { batch_id: BID } });
const allocs = await prisma.batchHouseAllocation.findMany({ where: { batch_id: BID } });

check("batch SOLD with actual_end_date", bRow.status === "SOLD" && !!bRow.actual_end_date);
check("conservation: initial = died + sold", INITIAL === sum(mort, (m) => m.count_died) + sum(sales, (s) => s.birds_count), `${INITIAL} vs ${sum(mort, (m) => m.count_died)}+${sum(sales, (s) => s.birds_count)}`);
check("mortality rows sum = model", sum(mort, (m) => m.count_died) === M.died);
check("sold birds = model", sum(sales, (s) => s.birds_count) === M.sold);
check("allocations: INITIAL = chick count", sum(allocs.filter((a) => a.reason === "INITIAL"), (a) => a.quantity) === INITIAL);
check("allocations: moves out of brooder = into grower", sum(allocs.filter((a) => a.reason === "TRANSFER"), (a) => a.quantity) === sum(allocs.filter((a) => a.reason === "TRANSFER" && a.to_house_id === H.G), (a) => a.quantity));
check("allocations: balances all zero", bRow.houseBalances.every((x) => x.quantity === 0));
const chickLines = await prisma.purchaseItem.findMany({ where: { batch_id: BID } });
check("chick purchase lines = initial_chick_count", sum(chickLines, (l) => Number(l.quantity)) === INITIAL);
check("chick purchase cost", r2(sum(chickLines, (l) => Number(l.total_price))) === M.chickCost);
check("houses both end CLEANING", (await prisma.houses.findMany({ where: { id: { in: [H.B, H.G] } } })).every((h) => h.phase === "CLEANING"));
for (const [name, n] of [["vaccinations", 5], ["weight records", 9], ["mortality records", 50]] as const) {
    const have = name === "vaccinations" ? await prisma.vaccinations.count({ where: { batch_id: BID } }) : name === "weight records" ? await prisma.weightRecords.count({ where: { batch_id: BID } }) : mortalityIds.length;
    check(`count: ${name} ${name === "mortality records" ? ">=" : "="} ${n}`, name === "mortality records" ? have >= n : have === n, `got ${have}`);
}
check("medications recorded (3 vitamin + 5 abx + 3 vitamin)", (await prisma.medications.count({ where: { batch_id: BID } })) === 11);
check("every med/vacc has a linked consumption", (await prisma.medications.count({ where: { batch_id: BID, consumption_id: null } })) + (await prisma.vaccinations.count({ where: { batch_id: BID, consumption_id: null } })) === 0);
const weights = (await prisma.weightRecords.findMany({ where: { batch_id: BID, house_id: H.G }, orderBy: { date: "asc" } })).map((w) => Number(w.average_wt_grams));
check("weights rise week over week (grower house)", weights.every((w, i) => i === 0 || w > weights[i - 1]!), weights.join(","));

// ledger vs model, per SIM item
for (const key of ["starter", "grower", "finisher", "husk", "vitamin"] as const) {
    const rows = await prisma.stockLedger.findMany({ where: { item_id: it[key] } });
    const bal = (lt: string, id?: string) => r2(sum(rows.filter((r) => r.location_type === lt && (!id || r.location_id === id)), (r) => (r.direction === "IN" ? 1 : -1) * Number(r.quantity)));
    const whs = bal("WAREHOUSE", warehouse.id), hb = bal("HOUSE", H.B), hg = bal("HOUSE", H.G);
    check(`ledger ${key}: warehouse = model`, whs === r2(M.whs[key] ?? 0), `${whs} vs ${M.whs[key]}`);
    check(`ledger ${key}: brooder = model`, hb === r2(M.house.B[key] ?? 0), `${hb} vs ${M.house.B[key]}`);
    check(`ledger ${key}: grower = model`, hg === r2(M.house.G[key] ?? 0), `${hg} vs ${M.house.G[key]}`);
    const used = r2(sum(await prisma.consumption.findMany({ where: { item_id: it[key], batch_id: BID } }), (c) => Number(c.base_quantity)));
    check(`consumption ${key}: DB = model`, used === r2(M.consumed[key] ?? 0), `${used} vs ${M.consumed[key]}`);
}
const leftover = r2(["starter", "grower", "finisher"].reduce((s, k) => s + (M.whs[k] ?? 0) + (M.house.B[k] ?? 0) + (M.house.G[k] ?? 0), 0));

// money
const purchaseRows = await prisma.purchase.findMany({ where: { invoice_no: { startsWith: "SIM-INV" } }, include: { items: true } });
check("purchases: total = Σ lines - discount", purchaseRows.every((p) => { const g = sum(p.items, (i) => Number(i.total_price)); const d = p.discount_type === "FLAT" ? Number(p.discount_value) : 0; return r2(g - d) === r2(Number(p.total_amount)); }));
let payables = 0;
for (const p of purchaseRows) {
    const paid = Number((await prisma.payment.aggregate({ where: { ref_type: "PURCHASE", ref_id: p.id }, _sum: { amount: true } }))._sum.amount ?? 0);
    payables += Number(p.total_amount) - paid;
    check(`purchase ${p.invoice_no}: paid <= total`, paid <= Number(p.total_amount) + 0.001);
}
const revenue = r2(sum(sales, (s) => Number(s.total_amount)));
const discounts = r2(sum(sales, (s) => Number(s.discount_amount)));
check("sales revenue = model", revenue === r2(M.revenue), `${revenue} vs ${M.revenue}`);
let receivable = 0;
for (const s of sales) {
    const paid = Number((await prisma.payment.aggregate({ where: { ref_type: "BIRD_SALE", ref_id: s.id }, _sum: { amount: true } }))._sum.amount ?? 0);
    receivable += Number(s.due_amount) - paid;
}

// analytics must agree with the books
const perf = (await api("admin", "GET", "/analytics/batches/performance?status=SOLD")).data?.find((x: any) => x.batch_id === BID);
const pnl = (await api("admin", "GET", `/analytics/batches/${BID}/pnl`)).data;
const perf1 = (await api("admin", "GET", `/analytics/batches/${BID}/performance`)).data;
const overview = (await api("admin", "GET", "/analytics/overview")).data;
check("analytics: cumulative_died", perf?.cumulative_died === M.died, `${perf?.cumulative_died}`);
check("analytics: mortality rate", Math.abs(perf?.cumulative_mortality_rate - M.died / INITIAL) < 1e-9);
check("analytics: live_count = 0", perf?.live_count === 0);
check("analytics: feed_kg = Σ feed consumed", Math.abs(perf?.feed_kg - M.feedKg) < 0.01, `${perf?.feed_kg} vs ${M.feedKg}`);
check("analytics: farm overview shows 0 running batches", overview?.active_batch_count === 0 && overview?.total_birds_alive === 0);
const soldKg = sum(sales, (s) => Number(s.net_weight));
const gainKg = soldKg - (INITIAL * CHICK_WT) / 1000;
const fcrExpected = M.feedKg / gainKg;
check("analytics: FCR within 1% of feed / (sold kg - chick kg)", !!perf?.fcr && Math.abs(perf.fcr - fcrExpected) / fcrExpected < 0.01, `api=${perf?.fcr} expected=${fcrExpected}`);
check("pnl: revenue = Σ sales - discounts", r2(Number(pnl?.revenue)) === r2(revenue - discounts), `${pnl?.revenue}`);
check("pnl: purchase_cost = chick cost", r2(Number(pnl?.purchase_cost)) === M.chickCost, `${pnl?.purchase_cost}`);
check("pnl: direct expenses = Σ expenses", r2(Number(pnl?.direct_expenses)) === r2(M.expenses), `${pnl?.direct_expenses} vs ${M.expenses}`);

// the cost of everything the batch actually ate and took
const consumedCost = await (async () => {
    let total = 0;
    for (const key of ["starter", "grower", "finisher", "husk", "vitamin", "nd", "ibd", "abx"] as const) {
        const lines = await prisma.purchaseItem.findMany({ where: { item_id: it[key] } });
        const q = sum(lines, (l) => Number(l.base_quantity)), cost = sum(lines, (l) => Number(l.total_price));
        const used = sum(await prisma.consumption.findMany({ where: { item_id: it[key], batch_id: BID } }), (c) => Number(c.base_quantity));
        total += q > 0 ? (cost / q) * used : 0;
    }
    return r2(total);
})();
const trueProfit = r2(revenue - discounts - M.chickCost - M.expenses - consumedCost);
const pnlProfit = r2(Number(pnl?.profit));
if (Math.abs(pnlProfit - trueProfit) > 1000) {
    finding("BUG", `GET /analytics/batches/:id/pnl reports profit ${pnlProfit.toLocaleString()} but the batch consumed ${consumedCost.toLocaleString()} of feed/bedding/medicine that the formula leaves out (analytics.service.ts batchPnl: revenue - chick purchases - direct expenses - depreciation). True profit is about ${trueProfit.toLocaleString()}. batchesPerformance.cost_to_date does include consumption, so the two screens disagree about the same batch.`);
}
check("pnl.profit includes feed/medicine cost", Math.abs(pnlProfit - trueProfit) <= 1000, `pnl=${pnlProfit} true=${trueProfit}`);
const sinceEnd = Math.floor((Date.now() - bRow.starting_date.getTime()) / 86_400_000);
if (perf && perf.age_days === sinceEnd && sinceEnd > DAYS) {
    finding("NOTE", `analytics age_days for a SOLD batch keeps growing (${perf.age_days}d, from Date.now()) instead of stopping at the batch end (~${DAYS}d). Shows on the Analytics page for finished batches.`);
}
if (bRow.actual_end_date && bRow.actual_end_date.getTime() > T(62).getTime() + 86400_000) {
    finding("NOTE", `actual_end_date is stamped with the close request time (new Date()), not the last sale. Closing a batch a day late shifts bird-days / depreciation accordingly.`);
}

// the dashboards must agree with the books and with each other
const fin1 = (await api("admin", "GET", "/analytics/financial")).data;
const d = (k: string) => r2(Number(fin1?.[k]) - Number(fin0?.[k]));
check("dashboard: receivables rose by exactly the unpaid sales", d("outstanding_receivables") === r2(receivable), `${d("outstanding_receivables")} vs ${r2(receivable)}`);
check("dashboard: payables rose by exactly the unpaid purchases", d("outstanding_payables") === r2(payables), `${d("outstanding_payables")} vs ${r2(payables)}`);
const simPays = await prisma.payment.findMany({ where: { created_at: { gte: new Date(t0) } } });
const cashDelta = r2(sum(simPays, (p) => (p.direction === "INCOMING" ? 1 : -1) * Number(p.amount)));
check("dashboard: cash position moved by Σ(in - out) payments", d("cash_position") === cashDelta, `${d("cash_position")} vs ${cashDelta}`);
const probeExpense = await must("admin", "POST", "/expenses", { category: "MISC", cost_type: "SHARED_PERIOD", amount: 1, date: T(62, 17), remarks: "SIM probe: pay from an inactive account" }, "probe expense");
const inactivePay = await api("admin", "POST", "/payments", { amount: 1, payment_date: T(62, 17), ref_type: "EXPENSE", ref_id: probeExpense?.id ?? crypto.randomUUID(), from_instrument_id: cash.id });
check("probe: payment from an INACTIVE account is refused", inactivePay.status === 400, `status ${inactivePay.status} (purchase/sale paid-at-create refuses inactive accounts; POST /payments does not)`);
if (inactivePay.status < 300)
    finding("BUG", `POST /payments accepts an inactive payment account ("${cash.label}", is_active=false) that purchase/sale paid-at-create rejects (lib/paid-at-create.ts). The money then drops out of the dashboard cash position, which only sums active instruments -- seen as a 102,000 gap in a first run that paid expenses from it. Added a 1-taka payment to demonstrate.`);
const top = ((await api("admin", "GET", "/analytics/sales/top-outstanding-customers?limit=10")).data ?? []).find((x: any) => x.customer_id === cust.C);
check("top outstanding customer C = its unpaid balance", r2(Number(top?.due)) === r2(receivable), `${top?.due} vs ${r2(receivable)}`);
const tMort = (await api("admin", "GET", "/analytics/trends/mortality?days=70")).data ?? [];
check("trend: mortality Σ = died", sum(tMort, (x) => x.died) === M.died, `${sum(tMort, (x) => x.died)} vs ${M.died}`);
const preFeed = sum(await prisma.consumption.findMany({ where: { batch_id: null, item: { category: "FEED" } } }), (c) => Number(c.base_quantity));
const tFeed = (await api("admin", "GET", "/analytics/trends/feed?days=70")).data ?? [];
check("trend: feed Σ = feed consumed (+ pre-existing)", Math.abs(sum(tFeed, (x) => Number(x.quantity)) - (M.feedKg + preFeed)) < 0.01, `${sum(tFeed, (x) => Number(x.quantity))} vs ${M.feedKg + preFeed}`);
const tSales = (await api("admin", "GET", "/analytics/trends/sales?days=70")).data ?? [];
const grossOnly: string[] = [];
if (discounts > 0) {
    if (r2(Number(pnl?.revenue)) === revenue) grossOnly.push("batch P&L");
    if (d("revenue") === revenue) grossOnly.push("financial dashboard");
    if (r2(sum(tSales, (x) => Number(x.revenue))) === revenue) grossOnly.push("sales trend");
}
check("revenue figures are net of discount_amount", grossOnly.length === 0, `gross-only: ${grossOnly.join(", ")}`);
if (grossOnly.length)
    finding("BUG", `Revenue ignores discount_amount in: ${grossOnly.join(", ")}. They sum BirdSale.total_amount; the sim gave ${discounts.toLocaleString()} of discount, which stays in revenue (and receivable math, which does subtract it, then disagrees with revenue).`);

// alerts
const scan = (await api("admin", "POST", "/alerts/scan")).data;
const alerts = (scan ?? []) as any[];

// ── report ──────────────────────────────────────────────────────────────────
const pass = checks.filter((c) => c.pass).length;
const failed = checks.filter((c) => !c.pass);
const mortPct = ((M.died / INITIAL) * 100).toFixed(2);
const lastW = weights.at(-1);
const totalCost = r2(M.chickCost + M.expenses + consumedCost);
const L: string[] = [];
L.push(`# Batch lifecycle simulation -- report`, "");
L.push(`Batch \`${bRow.batch_code}\` (HIBREED), ${INITIAL} chicks, ${DAYS} days (2026-08-16 -> 2026-10-16), driven through the HTTP API as admin / worker / manager. Run took ${((Date.now() - t0) / 1000).toFixed(0)}s.`, "");
L.push(`**Checks: ${pass}/${checks.length} passed, ${failed.length} failed.**`, "");
L.push(`## Headline numbers`, "", `| | |`, `|---|---|`);
L.push(`| Chicks in / died / sold | ${INITIAL} / ${M.died} (${mortPct}%) / ${M.sold} |`);
L.push(`| Final avg weight (last sample, day 62) | ${lastW} g |`);
L.push(`| Feed used | ${M.feedKg.toLocaleString()} kg  (FCR api ${perf?.fcr?.toFixed(2)}, expected ${fcrExpected.toFixed(2)}) |`);
L.push(`| Revenue (sum of total_amount; ${discounts.toLocaleString()} discounted at sale) | ${revenue.toLocaleString()} |`);
L.push(`| Chicks + direct expenses + consumed stock | ${M.chickCost.toLocaleString()} + ${M.expenses.toLocaleString()} + ${consumedCost.toLocaleString()} = ${totalCost.toLocaleString()} |`);
L.push(`| True profit (revenue - discounts - costs) | ${r2(revenue - discounts - totalCost).toLocaleString()} |`);
L.push(`| P&L endpoint profit | ${pnlProfit.toLocaleString()} |`);
L.push(`| Receivable (customers still owe) / payable (suppliers) | ${r2(receivable).toLocaleString()} / ${r2(payables).toLocaleString()} |`);
L.push(`| Feed left unused (warehouse + houses) | ${leftover.toLocaleString()} kg |`);
L.push(`| Active alerts after scan | ${alerts.length} |`, "");
L.push(`## Findings`, "");
for (const f of findings) L.push(`- **${f.sev}** ${f.text}`);
if (!findings.length) L.push("- none");
L.push("", `## Failed checks`, "");
for (const c of failed) L.push(`- ${c.name} ${c.detail}`);
if (!failed.length) L.push("- none");
L.push("", `## Alerts raised by the scan`, "");
for (const a of alerts) L.push(`- [${a.level}] ${a.title}`);
if (!alerts.length) L.push("- none");
L.push("", `## Day by day`, "", `| Day | Alive (EOD) | Died | Feed kg | Weight g | Events |`, `|---|---|---|---|---|---|`);
for (const d of M.daily) L.push(`| ${d.day} | ${d.alive} | ${d.died} | ${d.feedKg} | ${d.avgG ?? ""} | ${d.note} |`);
L.push("", `## All checks`, "");
for (const c of checks) L.push(`- ${c.pass ? "PASS" : "**FAIL**"} ${c.name}${c.detail && !c.pass ? ` -- ${c.detail}` : ""}`);
writeFileSync(new URL("../docs/batch-lifecycle-sim-report.md", import.meta.url), L.join("\n") + "\n");

console.log = realLog;
out(`\n${pass}/${checks.length} checks passed, ${failed.length} failed, ${findings.length} findings. Report: docs/batch-lifecycle-sim-report.md`);
out(`mortality ${mortPct}%  FCR ${perf?.fcr?.toFixed(2)}  revenue ${revenue}  alerts ${alerts.length}`);
await prisma.$disconnect();
process.exit(0);
