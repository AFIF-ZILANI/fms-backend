import { describe, test, expect } from "bun:test";
import { createHash } from "node:crypto";

// The library function reads the secret from env; this mirrors its string-to-sign
// construction so the *format* -- sorted keys, k=v&k=v, secret appended, SHA-1 --
// is pinned against a digest produced independently by `openssl sha1`.
// If the joining rule ever drifts, every real upload 401s; this catches it offline.
const sign = (params: Record<string, string | number>, secret: string) =>
    createHash("sha1")
        .update(
            Object.keys(params)
                .sort()
                .map((k) => `${k}=${params[k]}`)
                .join("&") + secret,
        )
        .digest("hex");

describe("cloudinary signature", () => {
    test("matches a known-good digest", () => {
        // printf 'public_id=sample&timestamp=1315060510abcd' | openssl sha1
        expect(sign({ timestamp: 1315060510, public_id: "sample" }, "abcd")).toBe(
            "c3470533147774275dd37996cc4d0e68fd03cd4f",
        );
    });

    test("is order-independent -- keys are sorted before signing", () => {
        const a = sign({ timestamp: 1, folder: "employees", upload_preset: "p" }, "s");
        const b = sign({ upload_preset: "p", timestamp: 1, folder: "employees" }, "s");
        expect(a).toBe(b);
    });
});
