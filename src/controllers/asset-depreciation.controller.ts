import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { AssetDepreciationService } from "@services/asset-depreciation.service";
import type { ListAssetDepreciationsQuery } from "@validators/asset-depreciation.validator";

export const AssetDepreciationController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListAssetDepreciationsQuery>(c, "query");
            const { depreciations, meta } = await AssetDepreciationService.getAll(query);
            return sendList(c, depreciations, meta, "Asset depreciations fetched successfully");
        });
    },
};
