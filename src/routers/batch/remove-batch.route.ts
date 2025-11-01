import { RemoveBatch } from "@/controllers/batch/remove-batch.controller";
import { asyncHandler } from "@/utils/asyncHandler";
import { Router } from "express";

const router = Router();

router.delete("/remove", asyncHandler(RemoveBatch));

export default router;
