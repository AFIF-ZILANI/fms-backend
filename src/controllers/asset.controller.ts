import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { AssetService } from "@services/asset.service";
import type {
    CreateAssetInput,
    UpdateAssetStatusInput,
    ListAssetsQuery,
} from "@validators/asset.validator";

export const AssetController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListAssetsQuery>(c, "query");
            const { assets, meta } = await AssetService.getAll(query);
            return sendList(c, assets, meta, "Assets fetched successfully");
        });
    },

    async getById(c: Context) {
        return withHandler(c, async () => {
            const asset = await AssetService.getById(c.req.param("id") ?? "");
            return sendSuccess(c, asset, "Asset fetched successfully");
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<CreateAssetInput>(c, "json");
            const asset = await AssetService.create(body);
            return sendSuccess(c, asset, "Asset created", 201);
        });
    },

    async setStatus(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<UpdateAssetStatusInput>(c, "json");
            const asset = await AssetService.setStatus(c.req.param("id") ?? "", body.status);
            return sendSuccess(c, asset, "Asset status updated");
        });
    },
};
