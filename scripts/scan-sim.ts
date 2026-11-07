/**
 * Fast-scanning simulation for the mobile QR screens -- no camera, no phone. A list of codes is fed
 * through the app's own scan logic (mobile/src/lib: classifyScan, checkUnit/decideScan, the scan pump)
 * against the real HTTP API in-process, with the global rate limiter on and phone-to-server latency
 * added to every request. Then the database is audited.
 *
 *   bun scripts/scan-sim.ts <bind|allocate|return|start|finish> <old|new> [count=30]
 *
 * old = the scanner before the fix: one code at a time, frames read meanwhile dropped, the count
 *       refetch awaited after each write, every mounted list refetched per scan.
 * new = the scan pump: up to 4 codes in flight, the count refetch fire-and-forget (one at a time),
 *       the other lists refreshed once when scanning stops.
 *
 * The camera: one bottle every INTERVAL_MS, each in frame for DWELL_MS, read every FRAME_MS while in
 * frame. A bottle not handled while in frame is missed; the operator then re-scans whatever is
 * short in another pass. Writes to the dev database and cleans its fixtures up. Env: RTT_MS (250),
 * INTERVAL_MS (350), DWELL_MS (600).
 */
const realLog = console.log;
console.log = () => {};
const { app } = await import("../src/App");
const { default: prisma } = await import("../src/lib/db");
const { signSession } = await import("../src/lib/session");
const { StockUnitService } = await import("../src/services/stock-unit.service");
const { houseNumber, provisionPrinted, sharedWarehouseId } = await import("../src/lib/test-fixtures");
const scanLib = await import("../../mobile/src/lib/scan");
const { classifyScan, markSent, newScanState, releaseScan } = scanLib;
const { checkUnit, decideScan } = await import("../../mobile/src/lib/scan-actions");
const { createScanPump } = await import("../../mobile/src/lib/scan-pump");
const out = (s = "") => process.stdout.write(s + "\n");

type Scenario = "bind" | "allocate" | "return" | "start" | "finish";
const scenario = process.argv[2] as Scenario;
const variant = process.argv[3] as "old" | "new";
const N = Number(process.argv[4] ?? 30);
if (!["bind", "allocate", "return", "start", "finish"].includes(scenario) || !["old", "new"].includes(variant)) {
    out("usage: bun scripts/scan-sim.ts <bind|allocate|return|start|finish> <old|new> [count]");
    process.exit(1);
}
const RTT = Number(process.env.RTT_MS ?? 250);
const INTERVAL = Number(process.env.INTERVAL_MS ?? 350);
const DWELL = Number(process.env.DWELL_MS ?? 600);
const FRAME = 100;
const EXTRA = scenario === "bind" ? 3 : 0; // codes beyond the lot's size: none may link
// The old scanner gave up on a 429 for the rest of the session; the new one may retry it.
const isRetryable = (status: number) => (variant === "old" ? status === 0 || status >= 500 : scanLib.isRetryable(status));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();

// --- fixtures -------------------------------------------------------------------------------
const profile = await prisma.profiles.create({
    data: { name: "Scan Sim", mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`, role: "ADMIN" },
});
const token = await signSession(profile.id, profile.password_changed_at, "mobile");
const item = await prisma.item.create({
    data: {
        name: `Scan Sim Medicine ${crypto.randomUUID().slice(0, 8)}`,
        normalized_key: `scan sim medicine ${crypto.randomUUID()}`,
        category: "MEDICINE",
        unit: "BOTTLE",
        is_unit_tracked: true,
    },
});
const purchase = await prisma.purchase.create({
    data: {
        warehouse_id: await sharedWarehouseId(),
        purchase_date: new Date(),
        total_amount: N * 10,
        paid_amount: N * 10,
        due_amount: 0,
        recorded_by_id: profile.id,
    },
});
const lot = await prisma.purchaseItem.create({
    data: {
        purchase_id: purchase.id,
        item_id: item.id,
        quantity: N,
        unit: "BOTTLE",
        base_quantity: N,
        unit_price: 10,
        total_price: N * 10,
        ...(scenario !== "bind" && { unit_count: N }),
    },
});
const house = await prisma.houses.create({ data: { name: "Scan Sim House", type: "BROODER", number: houseNumber() } });

const units = await provisionPrinted(N + EXTRA);
const codes = units.map((u) => u.id);
const targets = codes.slice(0, N);
if (scenario !== "bind") {
    for (const id of targets) {
        await StockUnitService.bind(id, { purchase_item_id: lot.id });
        if (scenario !== "allocate") await StockUnitService.relocate(id, house.id, crypto.randomUUID());
        if (scenario === "finish")
            await StockUnitService.use(id, { action: "START", house_id: house.id, date: new Date(), recorded_by_id: profile.id });
    }
}

// --- network: the phone's view of the API ------------------------------------------------------
const stats = { requests: 0, tooMany: 0, byPath: new Map<string, number>() };
class ApiError extends Error {
    constructor(public status: number, message: string) {
        super(message);
    }
}
async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    stats.requests++;
    const key = `${init?.method ?? "GET"} ${path.split("?")[0]!.replace(/[0-9a-f-]{36}/g, ":id")}`;
    stats.byPath.set(key, (stats.byPath.get(key) ?? 0) + 1);
    await sleep(RTT / 2 + Math.random() * 30);
    const res = await app.fetch(
        new Request(`http://sim/api${path}`, {
            method: init?.method ?? "GET",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            ...(init?.body !== undefined && { body: JSON.stringify(init.body) }),
        }),
    );
    const text = await res.text();
    await sleep(RTT / 2 + Math.random() * 30);
    if (res.status === 429) stats.tooMany++;
    if (!res.ok) {
        let detail = text;
        try {
            detail = JSON.parse(text).detail ?? text;
        } catch {}
        throw new ApiError(res.status, detail);
    }
    const json = JSON.parse(text);
    return (json.data ?? json) as T;
}

// --- what each screen asks of the server ---------------------------------------------------------
const since = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
type Unit = Parameters<typeof checkUnit>[1];
const action = scenario === "allocate" ? "allocate" : scenario;
const plan = {
    action: action as "bind" | "allocate" | "return" | "start" | "finish",
    houseId: scenario === "bind" || scenario === "return" ? undefined : house.id,
    houseName: house.name,
    purchaseItemId: lot.id,
};
const commit = (id: string, key: string) => {
    switch (scenario) {
        case "bind":
            return api(`/stock-units/${id}/bind`, { method: "POST", body: { purchase_item_id: lot.id, unit_count: N } });
        case "allocate":
            return api(`/stock-units/${id}/relocate`, { method: "POST", body: { house_id: house.id, idempotency_key: key } });
        case "return":
            return api(`/stock-units/${id}/relocate`, { method: "POST", body: { house_id: null, idempotency_key: key } });
        default:
            return api(`/stock-units/${id}/use`, {
                method: "POST",
                body: { action: scenario === "start" ? "START" : "FINISH", house_id: house.id, date: new Date().toISOString(), idempotency_key: key },
            });
    }
};
/** The query the "N left" figure comes from, and the lists that refreshed with every scan before. */
const countQuery = async (): Promise<number | null> => {
    if (scenario === "bind") {
        const r = await api<{ id: string; _count?: { stockUnits: number } }[]>(`/purchase-items?limit=100&since=${encodeURIComponent(since)}`);
        const linked = (Array.isArray(r) ? r : []).find((p) => p.id === lot.id)?._count?.stockUnits ?? 0;
        return N - linked;
    }
    if (scenario === "start" || scenario === "finish") {
        const r = await api<{ item_id: string; units: number }[]>(
            `/houses/${house.id}/coded-stock${scenario === "finish" ? "?include_in_use=true" : ""}`,
        );
        return r.filter((l) => l.item_id === item.id).reduce((n, l) => n + l.units, 0);
    }
    return null;
};
const otherLists = (): Promise<unknown>[] =>
    scenario === "bind"
        ? []
        : scenario === "start" || scenario === "finish"
          ? [api("/items?is_active=true&limit=100"), api("/items/stock-by-location")]
          : [api(`/houses/${house.id}/coded-stock`)];

// --- the scan session (use-scan-session.ts) and scanner (qr-scanner.tsx), per variant --------------
const scanState = newScanState();
const done = new Set<string>();
const keys = new Map<string, string>();
const outcome = new Map<string, "ok" | string>();
let remaining: number | null = await countQuery();
let countInFlight = false;

async function onScan(id: string): Promise<{ ok: boolean; message?: string; retryable?: boolean }> {
    let unit: Unit;
    try {
        unit = await api<Unit>(`/stock-units/${id}`);
    } catch (e) {
        const err = e as ApiError;
        return { ok: false, message: err.message, retryable: isRetryable(err.status) };
    }
    const d = decideScan("auto", checkUnit(plan, unit), done.has(id));
    if (d.kind === "duplicate") return { ok: false, message: "duplicate", retryable: false };
    if (d.kind === "reject") return { ok: false, message: d.reason, retryable: false };
    const key = keys.get(id) ?? crypto.randomUUID();
    keys.set(id, key);
    try {
        await commit(id, key);
    } catch (e) {
        const err = e as ApiError;
        return { ok: false, message: err.message, retryable: isRetryable(err.status) };
    }
    done.add(id);
    keys.delete(id);
    if (variant === "old") {
        void Promise.allSettled(otherLists());
        // Awaited, so the next code was judged against the refreshed count.
        try {
            remaining = await countQuery();
        } catch {}
    } else if (!countInFlight) {
        // One count refetch at a time (invalidate with cancelRefetch: false); the pump guards the cap meanwhile.
        countInFlight = true;
        countQuery()
            .then((r) => pump.setRemaining(r), () => {})
            .finally(() => (countInFlight = false));
    }
    return { ok: true };
}

function settle(id: string, r: Awaited<ReturnType<typeof onScan>>) {
    if (r.ok) {
        outcome.set(id, "ok");
        return;
    }
    if (r.message === "duplicate") return;
    if (r.retryable) releaseScan(scanState, id);
    outcome.set(id, r.message ?? "error");
}

let inFlight = false;
const pump = createScanPump({
    limit: 4,
    run: async (id) => {
        const r = await onScan(id);
        settle(id, r);
        return r.ok;
    },
});
pump.setRemaining(remaining);

function onFrame(payload: string) {
    if (variant === "old") {
        if (inFlight || (remaining !== null && remaining <= 0)) return;
        const o = classifyScan(scanState, payload, Date.now());
        if (o.kind !== "accept") return;
        inFlight = true;
        markSent(scanState, o.id);
        void onScan(o.id)
            .then((r) => settle(o.id, r))
            .finally(() => (inFlight = false));
    } else {
        if (pump.room() === 0) return;
        const o = classifyScan(scanState, payload, Date.now());
        if (o.kind !== "accept") return;
        markSent(scanState, o.id);
        pump.push(o.id);
    }
}
const settled = async () => {
    if (variant === "new") return pump.idle();
    while (inFlight) await sleep(20);
};

// --- the operator ---------------------------------------------------------------------------------
const t0 = now();
let passes = 0;
let presented = 0;
const firstPassMissed: string[] = [];
// Link: any N codes fill the lot. The others: these particular N units.
const pool = scenario === "bind" ? codes : targets;
const doneCount = () => pool.filter((id) => outcome.get(id) === "ok").length;
while (passes < 10 && doneCount() < N) {
    const todo = pool.filter((id) => outcome.get(id) !== "ok");
    passes++;
    // A code that failed for good this session is released by the operator closing and reopening the scanner.
    if (passes > 1) for (const id of todo) releaseScan(scanState, id);
    for (const id of todo) {
        presented++;
        const tick = setInterval(() => onFrame(id), FRAME);
        onFrame(id);
        setTimeout(() => clearInterval(tick), DWELL);
        await sleep(INTERVAL);
    }
    await sleep(DWELL);
    await settled();
    if (passes === 1) firstPassMissed.push(...pool.filter((id) => !outcome.has(id)));
}
if (variant === "new") await Promise.allSettled(otherLists());
const elapsed = (now() - t0) / 1000;

// --- audit ------------------------------------------------------------------------------------------
const audit: string[] = [];
const check = (ok: boolean, what: string) => audit.push(`${ok ? "PASS" : "FAIL"}  ${what}`);
const rows = await prisma.stockUnit.findMany({
    where: { id: { in: codes } },
    include: { houseAllocations: { orderBy: [{ occurred_at: "desc" }, { created_at: "desc" }] } },
});
const byId = new Map(rows.map((r) => [r.id, r]));
const tgt = targets.map((id) => byId.get(id)!);
const okCount = doneCount();
check(okCount === N, `${N} codes reported done (${okCount})`);
if (scenario === "bind") {
    const linked = rows.filter((u) => u.purchase_item_id === lot.id);
    check(linked.length === N && linked.every((u) => u.status === "BOUND"), `exactly ${N} bound to the lot, never more (${linked.length})`);
    check(
        rows.filter((u) => u.purchase_item_id === null).every((u) => u.status === "PRINTED"),
        `the ${EXTRA} codes over the lot's size stayed unlinked`,
    );
    const lotNow = await prisma.purchaseItem.findUniqueOrThrow({ where: { id: lot.id } });
    check(lotNow.unit_count === N, `lot split into ${N} (${lotNow.unit_count})`);
}
if (scenario === "allocate" || scenario === "return") {
    const wanted = scenario === "allocate" ? house.id : null;
    check(tgt.every((u) => (u.houseAllocations[0]?.house_id ?? null) === wanted), `all ${N} now at ${wanted ? "the house" : "the warehouse"}`);
    const moves = tgt.map((u) => u.houseAllocations.length);
    const expected = scenario === "allocate" ? 1 : 2;
    check(moves.every((m) => m === expected), `exactly one move recorded per unit (no doubles)`);
}
if (scenario === "start") check(tgt.every((u) => u.status === "IN_USE"), `all ${N} in use`);
if (scenario === "finish") {
    check(tgt.every((u) => u.status === "CONSUMED"), `all ${N} consumed`);
    const consumptions = await prisma.consumption.groupBy({ by: ["stock_unit_id"], where: { stock_unit_id: { in: targets } }, _count: true });
    check(consumptions.length === N && consumptions.every((c) => c._count === 1), `exactly one consumption per unit (${consumptions.length})`);
    const ledger = await prisma.stockLedger.count({ where: { item_id: item.id, reason: "CONSUMPTION", direction: "OUT" } });
    check(ledger === N, `one ledger OUT per consumption (${ledger})`);
}
const errors = new Map<string, number>();
for (const [, o] of outcome) if (o !== "ok") errors.set(o, (errors.get(o) ?? 0) + 1);

// --- cleanup ------------------------------------------------------------------------------------------
const transferIds = (await prisma.stockHouseAllocation.findMany({ where: { stock_unit_id: { in: codes } }, select: { stock_transfer_id: true } }))
    .map((a) => a.stock_transfer_id)
    .filter((x): x is string => !!x);
await prisma.stockHouseAllocation.deleteMany({ where: { stock_unit_id: { in: codes } } });
await prisma.consumption.deleteMany({ where: { stock_unit_id: { in: codes } } });
await prisma.stockLedger.deleteMany({ where: { item_id: item.id } });
await prisma.stockTransfer.deleteMany({ where: { OR: [{ id: { in: transferIds } }, { item_id: item.id }] } });
await prisma.stockUnit.deleteMany({ where: { id: { in: codes } } });
await prisma.purchaseItem.deleteMany({ where: { id: lot.id } });
await prisma.purchase.deleteMany({ where: { id: purchase.id } });
await prisma.item.deleteMany({ where: { id: item.id } });
await prisma.houses.deleteMany({ where: { id: house.id } });
await prisma.auditLog.deleteMany({ where: { changed_by_id: profile.id } }).catch(() => {});
await prisma.profiles.deleteMany({ where: { id: profile.id } }).catch(() => {});

// --- report -------------------------------------------------------------------------------------------
const result = {
    scenario,
    variant,
    codes: N,
    seconds: Number(elapsed.toFixed(1)),
    perCode: Number((elapsed / N).toFixed(2)),
    passes,
    missedFirstPass: firstPassMissed.length,
    presented,
    requests: stats.requests,
    tooMany: stats.tooMany,
    errors: Object.fromEntries(errors),
    audit,
};
out(JSON.stringify(result));
console.log = realLog;
await prisma.$disconnect();
process.exit(audit.some((a) => a.startsWith("FAIL")) ? 2 : 0);
