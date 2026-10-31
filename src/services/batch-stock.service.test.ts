import { describe, test, expect } from "bun:test";
import { stayWindows } from "./batch-stock.service";

const t = (day: number) => new Date(Date.UTC(2009, 5, day));

describe("stayWindows", () => {
    test("a house the batch left ends when its balance hit zero; one it's still in runs to the batch's end", () => {
        const stays = stayWindows(
            [
                { to_house_id: "brooder", occurred_at: t(1) },
                { to_house_id: "grower", occurred_at: t(12) },
                { to_house_id: "grower", occurred_at: t(10) }, // staggered shift: the earliest move in counts
                { to_house_id: null, occurred_at: t(20) }, // a move out names no destination
            ],
            [
                { house_id: "brooder", quantity: 0, updated_at: t(12) },
                { house_id: "grower", quantity: 300, updated_at: t(15) },
            ],
            t(30),
        );
        expect(stays).toEqual([
            { house_id: "brooder", from: t(1), to: t(12) },
            { house_id: "grower", from: t(10), to: t(30) },
        ]);
    });

    test("a window never runs past the batch's end or before its start", () => {
        const [stay] = stayWindows(
            [{ to_house_id: "h", occurred_at: t(5) }],
            [{ house_id: "h", quantity: 0, updated_at: t(40) }], // touched after the batch closed
            t(30),
        );
        expect(stay).toEqual({ house_id: "h", from: t(5), to: t(30) });
    });
});
