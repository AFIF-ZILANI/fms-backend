import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { AlertService } from "@services/alert.service";
import type { CreateAlertInput, ListAlertsQuery } from "@validators/alert.validator";

export const AlertController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListAlertsQuery>(c, "query");
            const { alerts, meta } = await AlertService.getAll(query);
            return sendList(c, alerts, meta, "Alerts fetched successfully");
        });
    },

    async getById(c: Context) {
        return withHandler(c, async () => {
            const alert = await AlertService.getById(c.req.param("id") ?? "");
            return sendSuccess(c, alert, "Alert fetched successfully");
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<CreateAlertInput>(c, "json");
            const alert = await AlertService.create(body);
            return sendSuccess(c, alert, "Alert created", 201);
        });
    },

    async resolve(c: Context) {
        return withHandler(c, async () => {
            const alert = await AlertService.resolve(c.req.param("id") ?? "");
            return sendSuccess(c, alert, "Alert resolved");
        });
    },

    async scan(c: Context) {
        return withHandler(c, async () => {
            const { alerts, meta } = await AlertService.runScan();
            return sendList(c, alerts, meta, "Scan complete");
        });
    },
};
