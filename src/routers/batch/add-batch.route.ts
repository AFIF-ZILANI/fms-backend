
import { AddBatch } from "@/controllers/batch/add-batch.controller";
import { asyncHandler } from "@/utils/asyncHandler";
import { Router } from "express";

const router = Router();

router.post("/add", asyncHandler(AddBatch))

export default router;
