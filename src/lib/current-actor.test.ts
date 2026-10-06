import { describe, test, expect } from "bun:test";
import type { Context } from "hono";
import { getActorId } from "./current-actor";

/** The one rule worth a test: the actor never comes from the request body --
 * a proven identity wins, and nothing here reads `c.req`. */
const ctx = (vars: Record<string, unknown>) =>
    ({
        get: (k: string) => vars[k],
        req: {
            json: () => {
                throw new Error("getActorId must never read the request body");
            },
        },
    }) as unknown as Context;

describe("getActorId", () => {
    test("uses the logged-in profile", async () => {
        expect(await getActorId(ctx({ auth: { profile_id: "me" } }))).toBe("me");
    });

    test("uses the profile a device proved", async () => {
        expect(await getActorId(ctx({ device: { profile_id: "device-profile" } }))).toBe(
            "device-profile",
        );
    });

    test("no identity at all is a 401, not a silent fallback", async () => {
        await expect(getActorId(ctx({}))).rejects.toMatchObject({ status: 401 });
    });
});
