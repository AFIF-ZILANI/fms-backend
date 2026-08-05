import { describe, test, expect, afterAll } from "bun:test";
import prisma from "@lib/db";
import { PaymentInstrumentService } from "./payment-instrument.service";
import { AppError } from "@lib/app-error";

const createdIds: string[] = [];

describe("PaymentInstrumentService", () => {
    afterAll(async () => {
        await prisma.paymentInstrument.deleteMany({ where: { id: { in: createdIds } } });
    });

    test("create then getById round-trips", async () => {
        const instrument = await PaymentInstrumentService.create({
            owner_type: "ADMIN",
            owner_id: crypto.randomUUID(),
            type: "BANK_TRANSFER",
            label: "Farm Main Account",
            bank_name: "City Bank",
        });
        createdIds.push(instrument.id);

        const found = await PaymentInstrumentService.getById(instrument.id);
        expect(found.label).toBe("Farm Main Account");
        expect(found.is_active).toBe(true);
    });

    test("getById on unknown id throws not-found", async () => {
        await expect(
            PaymentInstrumentService.getById("00000000-0000-0000-0000-000000000000"),
        ).rejects.toBeInstanceOf(AppError);
    });

    test("setActive toggles is_active", async () => {
        const instrument = await PaymentInstrumentService.create({
            owner_type: "ADMIN",
            owner_id: crypto.randomUUID(),
            type: "CASH",
            label: "Petty Cash",
        });
        createdIds.push(instrument.id);

        const deactivated = await PaymentInstrumentService.setActive(instrument.id, false);
        expect(deactivated.is_active).toBe(false);
    });

    test("getBalance with no payments returns zero", async () => {
        const instrument = await PaymentInstrumentService.create({
            owner_type: "ADMIN",
            owner_id: crypto.randomUUID(),
            type: "CASH",
            label: "Empty Account",
        });
        createdIds.push(instrument.id);

        const balance = await PaymentInstrumentService.getBalance(instrument.id);
        expect(balance.balance.toNumber()).toBe(0);
    });
});
