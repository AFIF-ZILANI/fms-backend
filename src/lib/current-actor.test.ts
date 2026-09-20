import { describe, test, expect } from "bun:test";
import type { Context } from "hono";
import { getActorId } from "./current-actor";

/** The one rule worth a test: the actor never comes from the request body --
 * a proven device identity wins, and nothing here reads `c.req`. */
describe("getActorId", () => {
    test("uses the profile a device proved", async () => {
        const c = {
            get: (k: string) => (k === "device" ? { profile_id: "device-profile" } : undefined),
            req: {
                json: () => {
                    throw new Error("getActorId must never read the request body");
                },
            },
        } as unknown as Context;
        expect(await getActorId(c)).toBe("device-profile");
    });
});
