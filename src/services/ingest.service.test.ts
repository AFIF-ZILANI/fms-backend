import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { DeviceService } from "./device.service";
import { IngestService } from "./ingest.service";
import type { IngestSaleInput } from "@validators/ingest.validator";

let profileId: string;
let deviceId: string;

function payload(saleId: string, overrides: Partial<IngestSaleInput> = {}): IngestSaleInput {
    return {
        sale_id: saleId,
        batch_name: "2026-09-01",
        sale_date: new Date(),
        is_pcs_tracked: true,
        has_cull: false,
        main: {
            weight_kg: 82,
            net_weight_kg: 80,
            pcs: 40,
            avg_wt_grams: 2050,
            price_per_kg: 195,
            amount: 15600,
            total_crates: 4,
            deduction_per_crate_g: 500,
            total_deduction_wt_kg: 2,
            is_full_crates_only: true,
        },
        buyer_name: "Afzal Khan",
        buyer_type: "wholesaler",
        final_amount: 15600,
        received_amount: 15600,
        ...overrides,
    };
}

describe("IngestService", () => {
    beforeAll(async () => {
        const profile = await prisma.profiles.create({
            data: {
                name: "Ingest Test Operator",
                mobile: `+880${Math.floor(1e9 + Math.random() * 8e9)}`,
                role: "ADMIN",
            },
        });
        profileId = profile.id;
        const { code } = await DeviceService.createPairingCode(profileId);
        const paired = await DeviceService.redeemPairingCode(code, "Ingest phone", "android");
        deviceId = paired.device_id;
    });

    afterAll(async () => {
        await prisma.ingestedSale.deleteMany({ where: { recorded_by_id: profileId } });
        await prisma.device.deleteMany({ where: { profile_id: profileId } });
        await prisma.pairingCode.deleteMany({ where: { profile_id: profileId } });
        await prisma.profiles.deleteMany({ where: { id: profileId } });
    });

    test("a main-only session creates exactly one PENDING row", async () => {
        const saleId = crypto.randomUUID();
        const result = await IngestService.ingest(payload(saleId), {
            device_id: deviceId,
            profile_id: profileId,
        });

        expect(result.created).toBe(1);
        expect(result.rows[0]!.idempotency_key).toBe(`${saleId}:main`);
        expect(result.rows[0]!.portion).toBe("main");

        const row = await prisma.ingestedSale.findUnique({
            where: { idempotency_key: `${saleId}:main` },
        });
        expect(row?.status).toBe("PENDING");
        expect(row?.recorded_by_id).toBe(profileId);
    });

    test("re-posting the same session creates nothing new", async () => {
        const saleId = crypto.randomUUID();
        const ctx = { device_id: deviceId, profile_id: profileId };
        await IngestService.ingest(payload(saleId), ctx);
        const second = await IngestService.ingest(payload(saleId), ctx);

        expect(second.created).toBe(0);
        const rows = await prisma.ingestedSale.findMany({
            where: { idempotency_key: { startsWith: saleId } },
        });
        expect(rows.length).toBe(1);
    });

    test("a session with a sold cull portion creates two rows", async () => {
        const saleId = crypto.randomUUID();
        const result = await IngestService.ingest(
            payload(saleId, {
                has_cull: true,
                cull: {
                    is_sold: true,
                    weight_kg: 19,
                    pcs: 12,
                    sale_type: "weight",
                    price: 140,
                    amount: 2660,
                },
            }),
            { device_id: deviceId, profile_id: profileId },
        );

        expect(result.created).toBe(2);
        expect(result.rows.map((r) => r.portion).sort()).toEqual(["cull", "main"]);
    });

    test("an unsold cull portion creates only the main row", async () => {
        const saleId = crypto.randomUUID();
        const result = await IngestService.ingest(
            payload(saleId, {
                has_cull: true,
                cull: { is_sold: false, weight_kg: 19, pcs: 12 },
            }),
            { device_id: deviceId, profile_id: profileId },
        );

        expect(result.created).toBe(1);
        expect(result.rows[0]!.portion).toBe("main");
    });

    test("a sale dated more than 24h in the future is refused", async () => {
        const saleId = crypto.randomUUID();
        await expect(
            IngestService.ingest(
                payload(saleId, { sale_date: new Date(Date.now() + 48 * 3600_000) }),
                { device_id: deviceId, profile_id: profileId },
            ),
        ).rejects.toThrow("future");
    });
});
