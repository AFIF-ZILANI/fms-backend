import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { AssetController } from "@controllers/asset.controller";
import {
    createAssetSchema,
    updateAssetStatusSchema,
    listAssetsQuerySchema,
} from "@validators/asset.validator";

export const assetRoutes = new Hono();

assetRoutes.get("/", zValidatorRfc7807("query", listAssetsQuerySchema), AssetController.getAll);
assetRoutes.get("/:id", AssetController.getById);
assetRoutes.post("/", zValidatorRfc7807("json", createAssetSchema), AssetController.create);
assetRoutes.patch(
    "/:id/status",
    zValidatorRfc7807("json", updateAssetStatusSchema),
    AssetController.setStatus,
);
