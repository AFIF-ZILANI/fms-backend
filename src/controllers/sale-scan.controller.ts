import type { Context } from "hono";
import { getActorId } from "@lib/current-actor";
import { withHandler } from "@lib/helper";
import { sendSuccess } from "@lib/response";
import { getValid } from "@lib/valid";
import { SaleScanService } from "@services/sale-scan.service";
import type { ScanBottleInput } from "@validators/sale-scan.validator";

export const SaleScanController = {
    async waiting(c: Context) {
        return withHandler(c, async () =>
            sendSuccess(c, await SaleScanService.waiting(), "Sales waiting for bottles"),
        );
    },

    async get(c: Context) {
        return withHandler(c, async () =>
            sendSuccess(c, await SaleScanService.get(c.req.param("id") ?? ""), "Sale fetched"),
        );
    },

    async scan(c: Context) {
        return withHandler(c, async () => {
            const { stock_unit_id } = getValid<ScanBottleInput>(c, "json");
            const result = await SaleScanService.scan(
                c.req.param("id") ?? "",
                stock_unit_id,
                await getActorId(c),
            );
            return sendSuccess(c, result, "Bottle scanned");
        });
    },
};
