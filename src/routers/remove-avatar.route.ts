import { RemoveTempAvatar } from "@/controllers/remove-avatar.controller";
import { asyncHandler } from "@/utils/asyncHandler";
import { Router } from "express";

const router = Router();

router.delete("/delete", asyncHandler(RemoveTempAvatar));

export default router;
