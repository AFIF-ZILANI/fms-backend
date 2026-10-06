import { describe, test, expect } from "bun:test";
import { generateTempPassword, hashPassword, verifyPassword } from "./password";

describe("password", () => {
    test("verify accepts the right password and rejects a wrong one", async () => {
        const hash = await hashPassword("correct horse");
        expect(await verifyPassword("correct horse", hash)).toBe(true);
        expect(await verifyPassword("correct horsf", hash)).toBe(false);
    });

    test("same password hashes differently each time (salted)", async () => {
        expect(await hashPassword("x")).not.toBe(await hashPassword("x"));
    });

    test("a malformed stored hash fails closed", async () => {
        expect(await verifyPassword("x", "garbage")).toBe(false);
    });

    test("temp passwords avoid look-alike characters", () => {
        for (let i = 0; i < 200; i++) {
            expect(generateTempPassword()).toMatch(/^[a-hj-km-np-zA-HJ-NP-Z2-9]{10}$/);
        }
    });
});
