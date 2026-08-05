import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { AssetDepreciationController } from "@controllers/asset-depreciation.controller";
import { listAssetDepreciationsQuerySchema } from "@validators/asset-depreciation.validator";

export const assetDepreciationRoutes = new Hono();

assetDepreciationRoutes.get(
    "/",
    zValidatorRfc7807("query", listAssetDepreciationsQuerySchema),
    AssetDepreciationController.getAll,
);
