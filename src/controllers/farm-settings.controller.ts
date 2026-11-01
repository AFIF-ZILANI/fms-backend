import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { getAuth } from "@middlewares/authenticate";
import { sendSuccess } from "@lib/response";
import { getValid } from "@lib/valid";
import { FarmSettingsService } from "@services/farm-settings.service";
import type { UpdateFarmSettingsInput } from "@validators/farm-settings.validator";

export const FarmSettingsController = {
    async get(c: Context) {
        return withHandler(c, async () => sendSuccess(c, FarmSettingsService.get(), "Fetched successfully"));
    },

    async update(c: Context) {
        return withHandler(c, async () =>
            sendSuccess(
                c,
                await FarmSettingsService.update(getValid<UpdateFarmSettingsInput>(c, "json"), getAuth(c).profile_id),
                "Farm settings saved",
            ),
        );
    },
};
