import { describe, expect, test } from "bun:test";
import { isScanRequest } from "@lib/scan-route";
import { app } from "../App";

const ID = "4f8e11ef-1234-4abc-8def-0123456789ab";

describe("isScanRequest", () => {
    test("the scan lookup and the three scan writes", () => {
        expect(isScanRequest("GET", `/api/stock-units/${ID}`)).toBe(true);
        for (const a of ["bind", "relocate", "use"]) expect(isScanRequest("POST", `/api/stock-units/${ID}/${a}`)).toBe(true);
    });
    test("nothing else", () => {
        expect(isScanRequest("GET", "/api/stock-units")).toBe(false);
        expect(isScanRequest("GET", `/api/stock-units/${ID}/profile`)).toBe(false);
        expect(isScanRequest("GET", `/api/stock-units/${ID}/bind`)).toBe(false);
        expect(isScanRequest("POST", `/api/stock-units/${ID}`)).toBe(false);
        expect(isScanRequest("POST", `/api/stock-units/${ID}/dispose`)).toBe(false);
        expect(isScanRequest("DELETE", `/api/stock-units/${ID}`)).toBe(false);
        expect(isScanRequest("PATCH", `/api/stock-units/${ID}/status`)).toBe(false);
        expect(isScanRequest("GET", `/api/stock-units/not-an-id`)).toBe(false);
        expect(isScanRequest("GET", "/api/purchases")).toBe(false);
    });
});

describe("rate limits", () => {
    // Unauthenticated, so each answers 401 -- the limiter runs first and counts it either way. In-process
    // requests share one client key, so this one test sees both buckets fill.
    const hit = (method: string, path: string) => app.fetch(new Request(`http://t${path}`, { method }));

    // Other test files send requests through the same app, so the general bucket may already be partly
    // used: assert on the buckets' own counters, not on absolute numbers. One after another, because the
    // limiter's memory store judges a same-instant burst against its final count.
    test("scanning has its own bigger bucket, and filling the general one doesn't block it", async () => {
        const before = Number((await hit("GET", "/api/purchases")).headers.get("ratelimit-remaining"));
        // 150 scans -- more than the general bucket's whole 120.
        const scans: Response[] = [];
        for (let i = 0; i < 150; i++) scans.push(await hit("GET", `/api/stock-units/${ID}`));
        expect(scans.filter((r) => r.status === 429)).toHaveLength(0);
        expect(Number(scans.at(-1)!.headers.get("ratelimit-limit"))).toBe(600);
        // None of them touched the general bucket.
        const after = Number((await hit("GET", "/api/purchases")).headers.get("ratelimit-remaining"));
        expect(after).toBe(Math.max(0, before - 1));
        // Fill the general bucket; scanning still goes through.
        let blocked = false;
        for (let i = 0; i < 130 && !blocked; i++) blocked = (await hit("GET", "/api/purchases")).status === 429;
        expect(blocked).toBe(true);
        expect((await hit("POST", `/api/stock-units/${ID}/use`)).status).not.toBe(429);
    });
});
