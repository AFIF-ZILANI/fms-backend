import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "@lib/db";
import { BatchFeedingProgramService } from "./batch-feeding-program.service";

let batchId: string;
let itemId: string;
const createdIds: string[] = [];

describe("BatchFeedingProgramService", () => {
    beforeAll(async () => {
        const item = await prisma.item.create({
            data: {
                name: `Starter Feed ${crypto.randomUUID()}`,
                normalized_key: `starter feed ${crypto.randomUUID()}`,
                category: "FEED",
                unit: "BAG",
            },
        });
        itemId = item.id;
        const batch = await prisma.batches.create({
            data: {
                batch_code: `FEED-${crypto.randomUUID()}`,
                breed: "PAKISTHANI",
                expected_selling_date: new Date(Date.now() + 30 * 86400_000),
                initial_chick_count: 500,
                init_chicks_avg_wt: 40,
            },
        });
        batchId = batch.id;
    });

    afterAll(async () => {
        await prisma.batchFeedingProgram.deleteMany({ where: { id: { in: createdIds } } });
        await prisma.batches.delete({ where: { id: batchId } });
        await prisma.item.delete({ where: { id: itemId } });
    });

    test("create then setEndDay to close out the phase", async () => {
        const program = await BatchFeedingProgramService.create({
            batch_id: batchId,
            feed_type: "STARTER",
            item_id: itemId,
            start_day: 1,
        });
        createdIds.push(program!.id);
        expect(program!.end_day).toBeNull();

        const closed = await BatchFeedingProgramService.setEndDay(program!.id, 14);
        expect(closed.end_day).toBe(14);
    });

    test("setEndDay on unknown id throws not-found", async () => {
        await expect(
            BatchFeedingProgramService.setEndDay("00000000-0000-0000-0000-000000000000", 10),
        ).rejects.toMatchObject({ status: 404 });
    });
});
